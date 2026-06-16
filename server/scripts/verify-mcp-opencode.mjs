import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { useIsolatedCapabilityKernelForVerifier } from "./capability-kernel-test-env.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    payload: text.trim() ? JSON.parse(text) : {}
  };
}

function apiKeyHeaders(token) {
  return {
    "Content-Type": "application/json",
    "X-Pact-Api-Key": token
  };
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-opencode-verify-"));
const restoreCapabilityKernelEnv = useIsolatedCapabilityKernelForVerifier();
const opencodeConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-opencode-config-"));
const opencodeConfigPath = path.join(opencodeConfigDir, "opencode.jsonc");

let server;
try {
  server = await startHttpServer({
    userDataPath,
    distPath: "",
    port: 0,
    runtimeOptions: {
      profile: "minimal"
    }
  });
} catch (error) {
  console.error(`FAIL: could not start server: ${error.message}`);
  process.exit(1);
}
await installAuthenticatedFetch(server);

let exitCode = 0;
try {
  const discovery = await fetchJson(`${server.url}/api/mcp/discovery`);
  assert.equal(discovery.status, 200, "Discovery endpoint should return 200");
  assert.equal(discovery.payload.name, "Pact");

  const localGrant = await fetchJson(`${server.url}/api/mcp/local-grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targets: ["opencode"],
      label: "verify-opencode-local-grant",
      connectorVersion: "verify"
    })
  });
  assert.equal(localGrant.status, 201, "Local grant for opencode should return 201");
  assert.equal(localGrant.payload.ok, true);
  assert.ok(localGrant.payload.token, "Local grant should return a token for opencode");
  assert.deepEqual(localGrant.payload.targets, ["opencode"]);
  const token = localGrant.payload.token;

  const mcpList = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(token),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "opencode-verify", version: "1" }
      }
    })
  });
  assert.equal(mcpList.status, 200, "MCP initialize should succeed with opencode grant token");
  assert.equal(mcpList.payload.result.serverInfo.name, "Pact");

  const toolsList = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(token),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    })
  });
  assert.equal(toolsList.status, 200, "MCP tools/list should succeed with opencode grant token");
  const toolNames = (toolsList.payload.result?.tools || []).map((t) => t.name);
  assert.ok(toolNames.length > 0, "tools/list should return at least one tool");

  const sampleConfig = { "$schema": "https://opencode.ai/config.json" };
  await fs.writeFile(opencodeConfigPath, JSON.stringify(sampleConfig, null, 2));
  const configAfterWrite = JSON.parse(await fs.readFile(opencodeConfigPath, "utf8"));
  assert.deepEqual(configAfterWrite, sampleConfig, "Sample OpenCode config should be writable and readable");

  const installedConfig = {
    "$schema": "https://opencode.ai/config.json",
    "mcp": {
      "pact": {
        "type": "remote",
        "url": `${server.url}/mcp`,
        "headers": { "X-Pact-Api-Key": token },
        "enabled": true
      }
    }
  };
  await fs.writeFile(opencodeConfigPath, JSON.stringify(installedConfig, null, 2));
  const configAfterInstall = JSON.parse(await fs.readFile(opencodeConfigPath, "utf8"));
  assert.equal(configAfterInstall.mcp?.pact?.type, "remote", "Pact type should be remote");
  assert.equal(configAfterInstall.mcp?.pact?.url, `${server.url}/mcp`, "Pact URL should match");
  assert.ok(configAfterInstall.mcp?.pact?.enabled, "Pact server should be enabled");
  assert.equal(
    configAfterInstall.mcp?.pact?.headers?.["X-Pact-Api-Key"],
    token,
    "OpenCode config should contain the correct Pact API key header"
  );

  configAfterInstall.mcp.pact = undefined;
  delete configAfterInstall.mcp.pact;
  await fs.writeFile(opencodeConfigPath, JSON.stringify(configAfterInstall, null, 2));
  const configAfterUninstall = JSON.parse(await fs.readFile(opencodeConfigPath, "utf8"));
  assert.equal(configAfterUninstall.mcp?.pact, undefined, "Pact entry should be removed after uninstall");

  const unauthorizedList = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
  });
  assert.equal(unauthorizedList.status, 401, "Unauthenticated MCP tools/list should return 401");
  assert.equal(unauthorizedList.payload.error.data.code, "missing_token");

  console.log("PASS: opencode MCP integration verified");
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  if (process.env.PACT_VERIFY_VERBOSE) {
    console.error(error);
  }
  exitCode = 1;
} finally {
  if (server?.close) {
    await server.close();
  }
  await fs.rm(userDataPath, { recursive: true, force: true }).catch(() => {});
  await fs.rm(opencodeConfigDir, { recursive: true, force: true }).catch(() => {});
  restoreCapabilityKernelEnv();
}

process.exit(exitCode);
