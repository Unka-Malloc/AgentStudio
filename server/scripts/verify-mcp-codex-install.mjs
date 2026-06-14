#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const connectorScript = path.join(repoRoot, "mcp-connector", "bin", "pact-mcp.mjs");

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    payload: rawText.trim() ? JSON.parse(rawText) : {}
  };
}

function mcpRequest(method, params = {}, id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params
  };
}

function apiKeyHeaders(token) {
  return {
    "Content-Type": "application/json",
    "X-Pact-Api-Key": token
  };
}

function runProcess(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
    }, options.timeoutMs || 30000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });
    child.on("error", (error) => {
      settled = true;
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: error.message });
    });
  });
}

async function findCodexCli() {
  const candidates = [
    process.env.CODEX_CLI_PATH || "",
    "/Applications/Codex.app/Contents/Resources/codex",
    path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "codex.cmd" : "codex"),
    "codex"
  ].filter(Boolean);
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const result = await runProcess(candidate, ["--version"], { timeoutMs: 10000 });
    if (result.code === 0) {
      return candidate;
    }
  }
  throw new Error(`Codex CLI not found. Checked: ${[...seen].join(", ")}`);
}

async function callMcp({ serverUrl, token, toolName = "pact.sharedspace", operation, input = {}, id = 1 }) {
  const response = await fetchJson(`${serverUrl}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: toolName,
      arguments: {
        apiVersion: "v0.0.1:mcp:interface-1",
        operation,
        input,
        clientVersion: "verify-mcp-codex-install"
      }
    }, id))
  });
  assert.equal(response.status, 200);
  assert.equal(response.payload.error, undefined, JSON.stringify(response.payload.error || {}, null, 2));
  return response.payload.result.structuredContent.payload;
}

async function installCodexConnector({ serverUrl, token, codexBin, codexHome, marketplaceRoot, discoveryFile, tokenEnv }) {
  const result = await runProcess(process.execPath, [
    connectorScript,
    "install",
    "--target", "codex",
    "--url", serverUrl,
    "--token", token,
    "--token-env", tokenEnv,
    "--codex-bin", codexBin,
    "--marketplace-root", marketplaceRoot,
    "--discovery-file", discoveryFile,
    "--no-verify",
    "--json"
  ], {
    env: {
      CODEX_HOME: codexHome,
      [tokenEnv]: token
    },
    timeoutMs: 60000
  });
  if (result.code !== 0) {
    throw new Error(`pact-mcp install --target codex failed: ${result.stderr || result.stdout}`);
  }
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true, JSON.stringify(payload, null, 2));
  assert.equal(payload.installed?.codex?.status, "installed", JSON.stringify(payload, null, 2));
  return payload;
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-codex-mcp-server-"));
const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "pact-codex-home-"));
const marketplaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-codex-marketplace-"));
const discoveryFile = path.join(codexHome, "pact-servers.json");
const tokenEnv = `PACT_VERIFY_CODEX_MCP_TOKEN_${randomBytes(4).toString("hex").toUpperCase()}`;
let server = null;

try {
  const codexBin = await findCodexCli();
  server = await startHttpServer({
    userDataPath,
    distPath: "",
    port: 0,
    runtimeOptions: { profile: "minimal" }
  });
  await installAuthenticatedFetch(server);

  const grant = await fetchJson(`${server.url}/api/mcp/local-grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pact-safety-confirm": "true" },
    body: JSON.stringify({
      targets: ["codex"],
      label: "verify-codex-mcp-install",
      connectorVersion: "verify",
      toolsets: ["pact.agent.workspace", "pact.storage.write"]
    })
  });
  assert.equal(grant.status, 201, JSON.stringify(grant.payload, null, 2));
  assert.equal(grant.payload.ok, true);
  assert.ok(grant.payload.token);
  assert.equal(grant.payload.toolsets.includes("pact.agent.workspace"), true);

  await installCodexConnector({
    serverUrl: server.url,
    token: grant.payload.token,
    codexBin,
    codexHome,
    marketplaceRoot,
    discoveryFile,
    tokenEnv
  });

  const codexConfigPath = path.join(codexHome, "config.toml");
  const codexConfig = await fs.readFile(codexConfigPath, "utf8");
  assert.match(codexConfig, /\[mcp_servers\.pact\]/);
  assert.match(codexConfig, new RegExp(`url\\s*=\\s*"${server.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/mcp"`));
  assert.match(codexConfig, new RegExp(`bearer_token_env_var\\s*=\\s*"${tokenEnv}"`));
  assert.doesNotMatch(codexConfig, new RegExp(grant.payload.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const codexMcpGet = await runProcess(codexBin, ["mcp", "get", "pact"], {
    env: {
      CODEX_HOME: codexHome,
      [tokenEnv]: grant.payload.token
    },
    timeoutMs: 30000
  });
  assert.equal(codexMcpGet.code, 0, codexMcpGet.stderr || codexMcpGet.stdout);
  assert.match(`${codexMcpGet.stdout}\n${codexMcpGet.stderr}`, /pact/i);
  assert.match(`${codexMcpGet.stdout}\n${codexMcpGet.stderr}`, /mcp/i);

  const tools = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(grant.payload.token),
    body: JSON.stringify(mcpRequest("tools/list", {}, 20))
  });
  assert.equal(tools.status, 200);
  assert.ok(tools.payload.result?.tools?.some((tool) => tool.name === "pact.sharedspace"));

  const created = await callMcp({
    serverUrl: server.url,
    token: grant.payload.token,
    operation: "pact.workspace.create",
    input: {
      title: "Codex MCP installed workspace",
      objective: "Verify Codex-installed Pact MCP can operate sharedspace files."
    },
    id: 21
  });
  const workspaceId = created.workspace?.workspaceRef || created.workspace?.workspaceId;
  assert.ok(workspaceId);

  const content = "Codex installed Pact MCP sharedspace verification\n";
  const upload = await callMcp({
    serverUrl: server.url,
    token: grant.payload.token,
    operation: "pact.workspace.file.upload",
    input: {
      workspaceId,
      folderPath: "codex-mcp",
      fileName: "proof.txt",
      content,
      createdBy: "verify-mcp-codex-install"
    },
    id: 22
  });
  assert.equal(upload.ok, true);
  assert.ok(upload.stateCommit?.commitId);
  assert.equal(upload.ingestReceipt?.status, "archived");
  assert.ok(upload.ingestReceipt?.manifestRootCid);

  const download = await callMcp({
    serverUrl: server.url,
    token: grant.payload.token,
    operation: "pact.workspace.file.download",
    input: {
      workspaceId,
      path: "codex-mcp/proof.txt"
    },
    id: 23
  });
  assert.equal(download.ok, true);
  assert.equal(download.content, content);
  assert.equal(download.cacheReceipt?.cacheFamily, "merkle-radix-compatible");
  assert.equal(download.cacheReceipt?.hit, true);
  assert.ok(download.cacheReceipt?.proofHash);

  console.log("mcp-codex-install verification passed");
} finally {
  if (server?.close) {
    await server.close();
  }
  await runProcess(process.execPath, [
    connectorScript,
    "uninstall",
    "--target", "codex",
    "--token-env", tokenEnv,
    "--codex-bin", process.env.CODEX_CLI_PATH || "/Applications/Codex.app/Contents/Resources/codex",
    "--marketplace-root", marketplaceRoot,
    "--discovery-file", discoveryFile,
    "--json"
  ], {
    env: { CODEX_HOME: codexHome },
    timeoutMs: 30000
  }).catch(() => {});
  await fs.rm(userDataPath, { recursive: true, force: true }).catch(() => {});
  await fs.rm(codexHome, { recursive: true, force: true }).catch(() => {});
  await fs.rm(marketplaceRoot, { recursive: true, force: true }).catch(() => {});
}
