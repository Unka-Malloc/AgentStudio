import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";
import { verifyMcpHandshakeSignature } from "../platform/common/mcp/identity.mjs";
import {
  capabilityPackageDigest,
  createCapabilityPackageRegistry,
  normalizeCapabilityPackageManifest
} from "../platform/specialized/capabilities/package-lifecycle/index.mjs";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    payload: text.trim() ? JSON.parse(text) : {}
  };
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  return {
    status: response.status,
    ok: response.ok,
    text: await response.text()
  };
}

async function captureMcpSseDuring({ url, headers = {}, action, until, timeoutMs = 5000 }) {
  const abortController = new AbortController();
  let text = "";
  let status = 0;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  const reader = (async () => {
    try {
      const response = await fetch(url, {
        headers: { ...headers, Accept: "text/event-stream" },
        signal: abortController.signal
      });
      status = response.status;
      resolveReady();
      const bodyReader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await bodyReader.read();
        if (value) {
          text += decoder.decode(value);
          if (until(text)) {
            abortController.abort();
            break;
          }
        }
        if (done) {
          break;
        }
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
      resolveReady();
    }
    return { status, text };
  })();
  await ready;
  assert.equal(status, 200);
  await action();
  return reader;
}

function mcpRequest(method, params = {}, id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params
  };
}

function mcpToolCall(name, operation, input = {}, id = 1) {
  return mcpRequest("tools/call", {
    name,
    arguments: {
      apiVersion: "pact.mcp.v1",
      operation,
      input
    }
  }, id);
}

function apiKeyHeaders(token) {
  return {
    "Content-Type": "application/json",
    "X-Pact-Api-Key": token
  };
}

function bearerHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  };
}

function signedManifest(input) {
  const normalized = normalizeCapabilityPackageManifest(input);
  return normalizeCapabilityPackageManifest({
    ...input,
    signature: {
      algorithm: "sha256",
      digestSha256: capabilityPackageDigest(normalized)
    }
  });
}

const RELEASE_BOOTSTRAP = `/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)"`;
const RELEASE_BOOTSTRAP_ZH_CN = `/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.zh-CN.sh)"`;

function assertNoMcpInternalLeak(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const filesystemLeak = /(^|[\s"'=:(])\/(?:Users|home|root|private|var|tmp|opt|usr|Volumes)\/[^\s"',)\]}]*/.exec(text) ||
    /(^|[\s"'=:(])[A-Za-z]:[\\/][^\s"',)\]}]*/.exec(text);
  assert.equal(/\bworkspace_[A-Za-z0-9_]+\b/.test(text), false, `${label} must not expose internal workspace ids`);
  assert.equal(
    Boolean(filesystemLeak),
    false,
    `${label} must not expose internal filesystem paths${filesystemLeak ? `: ${filesystemLeak[0]}` : ""}`
  );
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-mcp-http-"));
const server = await startHttpServer({
  userDataPath,
  distPath: "",
  port: 0,
  runtimeOptions: {
    profile: "minimal"
  }
});
await installAuthenticatedFetch(server);

try {
  const discovery = await fetchJson(`${server.url}/api/mcp/discovery`);
  assert.equal(discovery.status, 200);
  assert.equal(discovery.payload.mcpServers.pact.httpUrl, `${server.url}/mcp`);
  assert.equal(discovery.payload.stableToolName, "pact.call");
  assert.equal(discovery.payload.interfaceVersion, "pact.mcp.v1");
  assert.equal(discovery.payload.serverVersion, "0.0.1");
  assert.equal(discovery.payload.identity.algorithm, "Ed25519");
  assert.ok(discovery.payload.identity.keyId);
  assert.equal(discovery.payload.handshake.url, `${server.url}/api/mcp/handshake`);
  assert.equal(discovery.payload.sharedHub.sharedspace.outlet, "pact.sharedspace");
  assert.equal(discovery.payload.sharedHub.sharedspace.referencePolicy, "use-public-workspace-ref");
  assert.equal(discovery.payload.sharedHub.sharedspace.exchangeReceipt.schemaVersion, "pact.mcp.sharedspace-exchange.v1");
  assert.ok(discovery.payload.sharedHub.sharedspace.exchangeReceipt.locations.includes("notifications/pact/operation_reply.params.exchange"));
  assert.ok(discovery.payload.sharedHub.sharedspace.exchangeReceipt.fields.includes("outlet"));
  assert.ok(discovery.payload.sharedHub.sharedspace.exchangeReceipt.fields.includes("referencePolicy"));
  assert.ok(discovery.payload.sharedHub.sharedspace.exchangeReceipt.fields.includes("transferReceiptId"));
  assert.ok(discovery.payload.sharedHub.sharedspace.exchangeReceipt.actions.includes("drive-file-uploaded"));
  assert.ok(discovery.payload.sharedHub.sharedspace.coreOperations.includes("pact.sharedspace.file.write"));
  assert.ok(discovery.payload.sharedHub.sharedspace.coreOperations.includes("pact.sharedspace.localDir.connect"));
  assert.ok(discovery.payload.sharedHub.sharedspace.coreOperations.includes("pact.sharedspace.drive.file.upload"));
  assert.ok(discovery.payload.sharedHub.sharedspace.coreOperations.includes("pact.sharedspace.drive.sync.apply"));
  assert.equal(discovery.payload.installer.packageName, "pact-mcp-connector");
  assert.match(discovery.payload.installer.githubOneLineCommand, /pact-mcp-install\.sh/);
  assert.match(discovery.payload.installer.githubOneLineCommand, /curl -fL --retry 3 --connect-timeout 20 -sS/);
  assert.equal(discovery.payload.installer.githubOneLineCommandZhCN, RELEASE_BOOTSTRAP_ZH_CN);
  assert.match(discovery.payload.installer.githubOneLineInstallCommand, /pact-mcp-install\.sh.+--url/);
  assert.match(discovery.payload.installer.githubOneLineInstallCommandZhCN, /pact-mcp-install\.zh-CN\.sh.+--url/);
  assert.match(discovery.payload.installer.githubOneLineClientInstallJsonCommand, /pact-mcp-install\.sh.+--target <client>/);
  assert.match(discovery.payload.installer.githubOneLineClientInstallJsonCommand, /--json/);
  assert.match(discovery.payload.installer.githubOneLineClientInstallJsonCommandZhCN, /pact-mcp-install\.zh-CN\.sh.+--target <client>/);
  assert.match(discovery.payload.installer.githubOneLineClientInstallJsonCommandZhCN, /--json/);
  assert.match(discovery.payload.installer.githubOneLineAutoInstallCommand, /pact-mcp-install\.sh.+--target auto/);
  assert.match(discovery.payload.installer.githubOneLineAutoInstallCommand, /--json/);
  assert.match(discovery.payload.installer.githubOneLineAutoInstallCommandZhCN, /pact-mcp-install\.zh-CN\.sh.+--target auto/);
  assert.match(discovery.payload.installer.githubOneLineAutoInstallCommandZhCN, /--json/);
  assert.match(discovery.payload.installer.githubOneLinePriorityInstallCommand, /pact-mcp-install\.sh.+--target claude-code,codex,openclaw/);
  assert.match(discovery.payload.installer.githubOneLinePriorityInstallCommand, /--json/);
  assert.match(discovery.payload.installer.githubOneLinePriorityInstallCommandZhCN, /pact-mcp-install\.zh-CN\.sh.+--target claude-code,codex,openclaw/);
  assert.match(discovery.payload.installer.githubOneLinePriorityInstallCommandZhCN, /--json/);
  assert.equal(discovery.payload.installer.oneCommandInstall, discovery.payload.installer.githubOneLineInstallCommand);
  assert.equal(discovery.payload.installer.oneCommandInstallZhCN, discovery.payload.installer.githubOneLineInstallCommandZhCN);
  assert.equal(discovery.payload.installer.oneCommandClientInstallJson, discovery.payload.installer.githubOneLineClientInstallJsonCommand);
  assert.equal(discovery.payload.installer.oneCommandClientInstallJsonZhCN, discovery.payload.installer.githubOneLineClientInstallJsonCommandZhCN);
  assert.equal(discovery.payload.installer.oneCommandAutoInstall, discovery.payload.installer.githubOneLineAutoInstallCommand);
  assert.equal(discovery.payload.installer.oneCommandAutoInstallZhCN, discovery.payload.installer.githubOneLineAutoInstallCommandZhCN);
  assert.equal(discovery.payload.installer.oneCommandPriorityInstall, discovery.payload.installer.githubOneLinePriorityInstallCommand);
  assert.equal(discovery.payload.installer.oneCommandPriorityInstallZhCN, discovery.payload.installer.githubOneLinePriorityInstallCommandZhCN);
  assert.equal(discovery.payload.upgrade.reinstallCommand, discovery.payload.installer.githubOneLineInstallCommand);
  assert.equal(discovery.payload.upgrade.reinstallCommandZhCN, discovery.payload.installer.githubOneLineInstallCommandZhCN);
  assert.equal(discovery.payload.upgrade.clientReinstallJsonCommand, discovery.payload.installer.githubOneLineClientInstallJsonCommand);
  assert.equal(discovery.payload.upgrade.clientReinstallJsonCommandZhCN, discovery.payload.installer.githubOneLineClientInstallJsonCommandZhCN);
  assert.equal(discovery.payload.upgrade.agentReinstallCommand, discovery.payload.installer.githubOneLineAutoInstallCommand);
  assert.equal(discovery.payload.upgrade.agentReinstallCommandZhCN, discovery.payload.installer.githubOneLineAutoInstallCommandZhCN);
  assert.equal(discovery.payload.upgrade.priorityAgentReinstallCommand, discovery.payload.installer.githubOneLinePriorityInstallCommand);
  assert.equal(discovery.payload.upgrade.priorityAgentReinstallCommandZhCN, discovery.payload.installer.githubOneLinePriorityInstallCommandZhCN);
  assert.equal(discovery.payload.upgrade.oneCommandAgentReinstall, discovery.payload.upgrade.agentReinstallCommand);
  assert.equal(discovery.payload.upgrade.oneCommandAgentReinstallZhCN, discovery.payload.upgrade.agentReinstallCommandZhCN);
  assert.deepEqual(discovery.payload.upgrade.priorityTargets, ["claude-code", "codex", "openclaw"]);
  assert.match(discovery.payload.upgrade.reinstallCommand, new RegExp(`--url '${server.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert.match(discovery.payload.upgrade.clientReinstallJsonCommand, /--target <client>/);
  assert.match(discovery.payload.upgrade.clientReinstallJsonCommand, /--json/);
  assert.match(discovery.payload.upgrade.agentReinstallCommand, new RegExp(`--url '${server.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert.match(discovery.payload.upgrade.priorityAgentReinstallCommand, new RegExp(`--url '${server.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert.match(discovery.payload.installer.installCommand, /npx pact-mcp-connector@latest register/);
  assert.match(discovery.payload.installer.interactiveInstallCommand, /pact-mcp-connector@latest install/);
  assert.match(discovery.payload.installer.autoInstallCommand, /pact-mcp-connector@latest install --target auto/);
  assert.match(discovery.payload.installer.autoInstallCommand, /--json/);
  assert.match(discovery.payload.installer.priorityInstallCommand, /pact-mcp-connector@latest install --target claude-code,codex,openclaw/);
  assert.match(discovery.payload.installer.priorityInstallCommand, /--json/);
  assert.deepEqual(discovery.payload.installer.priorityTargets, ["claude-code", "codex", "openclaw"]);
  assert.match(discovery.payload.installer.clientInstallCommand, /--target <client>/);
  assert.equal(discovery.payload.installer.clientInstallJsonCommand, `npx pact-mcp-connector@latest install --target <client> --url '${server.url}' --json`);
  assert.doesNotMatch(discovery.payload.installer.clientInstallCommand, /token-stdin/);
  assert.equal(discovery.payload.installer.tokenInput, "auto-local-grant-or-stdin-or-env");
  assert.equal(discovery.payload.installer.localGrantEndpoint, `${server.url}/api/mcp/local-grant`);
  assert.match(discovery.payload.installer.scanCommand, /pact-mcp-connector@latest scan/);
  assert.match(discovery.payload.installer.scanCommand, /--json/);
  assert.match(discovery.payload.installer.discoverCommand, /pact-mcp-connector@latest discover-local/);
  assert.match(discovery.payload.installer.discoverCommand, /--json/);
  assert.match(discovery.payload.installer.autoInstallCommand, new RegExp(`--url '${server.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert.match(discovery.payload.installer.priorityInstallCommand, new RegExp(`--url '${server.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert.equal(discovery.payload.installer.portable.installCommand, `./pact-mcp register --url '${server.url}'`);
  assert.equal(discovery.payload.installer.portable.interactiveInstallCommand, `./pact-mcp install --url '${server.url}'`);
  assert.equal(discovery.payload.installer.portable.autoInstallCommand, `./pact-mcp install --target auto --url '${server.url}' --json`);
  assert.equal(discovery.payload.installer.portable.priorityInstallCommand, `./pact-mcp install --target claude-code,codex,openclaw --url '${server.url}' --json`);
  assert.deepEqual(discovery.payload.installer.portable.priorityTargets, ["claude-code", "codex", "openclaw"]);
  assert.equal(discovery.payload.installer.portable.clientInstallCommand, `./pact-mcp install --target <client> --url '${server.url}'`);
  assert.equal(discovery.payload.installer.portable.clientInstallJsonCommand, `./pact-mcp install --target <client> --url '${server.url}' --json`);
  const targetIds = discovery.payload.installer.supportedTargets.map((target) => target.target);
  const expectedInstallTargets = [
    "codex",
    "claude-code",
    "gemini-cli",
    "kilo-code",
    "copilot",
    "openclaw",
    "hermes",
    "antigravity",
    "opencode"
  ];
  assert.deepEqual(targetIds, expectedInstallTargets);
  const clientTargetsById = new Map(discovery.payload.clientTargets.map((target) => [target.target, target]));
  for (const targetId of expectedInstallTargets) {
    const target = clientTargetsById.get(targetId);
    assert.ok(target, `${targetId} should be present in discovery clientTargets`);
    assert.equal(target.install.npx, `npx pact-mcp-connector@latest install --target ${targetId} --url '${server.url}'`);
    assert.equal(target.install.npxJson, `npx pact-mcp-connector@latest install --target ${targetId} --url '${server.url}' --json`);
    assert.equal(target.install.portableJson, `./pact-mcp install --target ${targetId} --url '${server.url}' --json`);
    assert.match(target.install.oneCommand, new RegExp(`--target ${targetId}`));
    assert.match(target.install.oneCommand, new RegExp(`--url '${server.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
    assert.match(target.install.oneCommandJson, new RegExp(`--target ${targetId}`));
    assert.match(target.install.oneCommandJson, /--json/);
    assert.match(target.install.oneCommandJsonZhCN, /pact-mcp-install\.zh-CN\.sh/);
    assert.match(target.install.oneCommandJsonZhCN, new RegExp(`--target ${targetId}`));
    assert.match(target.install.oneCommandJsonZhCN, /--json/);
    assert.equal(target.install.npx.includes("token-stdin"), false);
    assert.equal(target.tokenInput, "auto-local-grant-or-stdin-or-env");
  }
  for (const targetId of ["codex", "claude-code", "openclaw", "opencode"]) {
    assert.equal(clientTargetsById.get(targetId).priority, true);
  }
  const codexInstallTarget = discovery.payload.installer.supportedTargets.find((target) => target.target === "codex");
  assert.ok(codexInstallTarget.locations.includes("local"));
  assert.ok(codexInstallTarget.locations.includes("orbstack"));
  assert.ok(codexInstallTarget.locations.includes("remote-linux"));
  assert.equal(clientTargetsById.get("codex").configTemplate.mcp_servers.pact.bearer_token_env_var, "PACT_MCP_TOKEN");
  assert.equal(clientTargetsById.get("claude-code").configTemplate.headers["X-Pact-Api-Key"], "${PACT_MCP_TOKEN}");
  assert.equal(clientTargetsById.get("openclaw").configTemplate.enabled, true);
  assert.equal(clientTargetsById.get("opencode").configTemplate.mcp.pact.type, "remote");
  assert.equal(discovery.payload.localDiscovery.files.length, 1);
  assert.match(discovery.payload.localDiscovery.entrypoint.command, /discover-local/);
  assert.match(discovery.payload.localDiscovery.entrypoint.command, /--json/);
  assert.ok(discovery.payload.localDiscovery.lookupOrder.includes("pact-mcp discover-local --json"));
  assert.equal(discovery.payload.installer.portable.requiresInstalledNode, false);
  assert.equal(discovery.payload.installer.portable.preferredArchive, "zip");
  assert.equal(discovery.payload.installer.portable.bootstrapScript, "pact-mcp-install.sh");
  assert.equal(discovery.payload.installer.portable.bootstrapScriptZhCN, "pact-mcp-install.zh-CN.sh");
  assert.equal(discovery.payload.installer.portable.githubOneLineCommandZhCN, RELEASE_BOOTSTRAP_ZH_CN);
  assert.equal(discovery.payload.installer.portable.supportsMultiSelect, true);
  assert.match(discovery.payload.installer.portable.autoInstallCommand, /\.\/pact-mcp install --target auto/);
  assert.match(discovery.payload.installer.portable.releaseAssetPattern, /\.zip$/);
  assert.equal(discovery.payload.mcpServers.pact.headers["X-Pact-Api-Key"], "${PACT_MCP_TOKEN}");
  assert.ok(discovery.payload.auth.acceptedHeaders.includes("Authorization: Bearer <token>"));
  assert.ok(discovery.payload.auth.acceptedHeaders.includes("X-Pact-Api-Key"));

  const nonce = randomBytes(32).toString("base64url");
  const handshake = await fetchJson(`${server.url}/api/mcp/handshake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nonce,
      client: { name: "verify-mcp-http", version: "1" }
    })
  });
  assert.equal(handshake.status, 200);
  assert.equal(handshake.payload.ok, true);
  assert.equal(handshake.payload.payload.nonce, nonce);
  assert.equal(handshake.payload.payload.server.name, "Pact");
  assert.equal(handshake.payload.payload.server.serverVersion, "0.0.1");
  assert.equal(handshake.payload.payload.identity.keyId, discovery.payload.identity.keyId);
  assert.equal(handshake.payload.payload.endpoints.mcpUrl, `${server.url}/mcp`);
  assert.equal(handshake.payload.payload.sharedHub.canonicalMcpUrl, `${server.url}/mcp`);
  assert.equal(handshake.payload.payload.sharedHub.sharedspace.outlet, "pact.sharedspace");
  assert.equal(handshake.payload.payload.sharedHub.sharedspace.referencePolicy, "use-public-workspace-ref");
  assert.equal(handshake.payload.payload.sharedHub.sharedspace.exchangeReceipt.schemaVersion, "pact.mcp.sharedspace-exchange.v1");
  assert.ok(handshake.payload.payload.sharedHub.sharedspace.coreOperations.includes("pact.sharedspace.file.write"));
  assert.ok(handshake.payload.payload.sharedHub.sharedspace.coreOperations.includes("pact.sharedspace.drive.file.upload"));
  assert.equal(handshake.payload.signature.algorithm, "Ed25519");
  assert.equal(
    verifyMcpHandshakeSignature({
      publicKeyJwk: handshake.payload.payload.identity.publicKeyJwk,
      payload: handshake.payload.payload,
      signature: handshake.payload.signature.value
    }),
    true
  );

  const abortController = new AbortController();
  let getMcpStatus = 500;
  let getMcpText = "";
  try {
    const res = await fetch(`${server.url}/mcp`, {
      headers: { Accept: "text/event-stream" },
      signal: abortController.signal
    });
    getMcpStatus = res.status;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (value) getMcpText += decoder.decode(value);
      if (getMcpText.includes("list_changed") || done) {
        abortController.abort();
        break;
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  }
  
  assert.equal(getMcpStatus, 200);
  assert.match(getMcpText, /notifications\/tools\/list_changed/);
  assert.match(getMcpText, /"sharedHub":\{/);
  assert.match(getMcpText, /"outlet":"pact\.sharedspace"/);
  assert.match(getMcpText, /"priorityTargets":\["claude-code","codex","openclaw"\]/);
  assert.match(getMcpText, /"supportedTargets":\[\{"target":"codex"/);

  const initialize = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mcpRequest("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "verify-mcp-http", version: "1" }
    }))
  });
  assert.equal(initialize.status, 200);
  assert.equal(initialize.payload.result.serverInfo.name, "Pact");
  assert.equal(initialize.payload.result.capabilities.tools.listChanged, true);
  assert.equal(initialize.payload.result._meta.stableToolName, "pact.call");
  assert.equal(initialize.payload.result._meta.sharedHub.canonicalMcpUrl, `${server.url}/mcp`);
  assert.equal(initialize.payload.result._meta.sharedHub.sharedspace.outlet, "pact.sharedspace");
  assert.equal(
    initialize.payload.result._meta.connector.autoInstallCommand,
    `npx pact-mcp-connector@latest install --target auto --url '${server.url}' --json`
  );
  assert.equal(
    initialize.payload.result._meta.connector.priorityInstallCommand,
    `npx pact-mcp-connector@latest install --target claude-code,codex,openclaw --url '${server.url}' --json`
  );
  assert.equal(
    initialize.payload.result._meta.connector.clientInstallJsonCommand,
    `npx pact-mcp-connector@latest install --target <client> --url '${server.url}' --json`
  );
  assert.match(initialize.payload.result._meta.connector.oneCommandClientInstallJson, /pact-mcp-install\.sh.+--target <client>/);
  assert.match(initialize.payload.result._meta.connector.oneCommandClientInstallJson, /--json/);
  assert.equal(initialize.payload.result._meta.connector.githubOneLineClientInstallJsonCommand, initialize.payload.result._meta.connector.oneCommandClientInstallJson);
  assert.match(initialize.payload.result._meta.connector.oneCommandClientInstallJsonZhCN, /pact-mcp-install\.zh-CN\.sh.+--target <client>/);
  assert.equal(initialize.payload.result._meta.connector.githubOneLineClientInstallJsonCommandZhCN, initialize.payload.result._meta.connector.oneCommandClientInstallJsonZhCN);
  assert.equal(initialize.payload.result._meta.connector.scanCommand, `npx pact-mcp-connector@latest scan --url '${server.url}' --json`);
  assert.match(initialize.payload.result._meta.connector.oneCommandPriorityInstall, /pact-mcp-install\.sh.+--target claude-code,codex,openclaw/);
  assert.equal(initialize.payload.result._meta.connector.githubOneLinePriorityInstallCommand, initialize.payload.result._meta.connector.oneCommandPriorityInstall);
  assert.match(initialize.payload.result._meta.connector.oneCommandPriorityInstallZhCN, /pact-mcp-install\.zh-CN\.sh.+--target claude-code,codex,openclaw/);
  assert.equal(initialize.payload.result._meta.connector.githubOneLinePriorityInstallCommandZhCN, initialize.payload.result._meta.connector.oneCommandPriorityInstallZhCN);
  assert.deepEqual(initialize.payload.result._meta.priorityTargets, ["claude-code", "codex", "openclaw"]);
  assert.deepEqual(initialize.payload.result._meta.supportedTargets.map((target) => target.target), expectedInstallTargets);

  const unauthenticatedList = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mcpRequest("tools/list", {}, 2))
  });
  assert.equal(unauthenticatedList.status, 401);
  assert.equal(unauthenticatedList.payload.error.data.code, "missing_token");
  assert.equal(
    unauthenticatedList.payload.error.data.connector.autoInstallCommand,
    `npx pact-mcp-connector@latest install --target auto --url '${server.url}' --json`
  );
  assert.equal(
    unauthenticatedList.payload.error.data.connector.clientInstallJsonCommand,
    `npx pact-mcp-connector@latest install --target <client> --url '${server.url}' --json`
  );
  assert.match(unauthenticatedList.payload.error.data.connector.oneCommandClientInstallJson, /pact-mcp-install\.sh.+--target <client>/);
  assert.equal(unauthenticatedList.payload.error.data.connector.githubOneLineClientInstallJsonCommand, unauthenticatedList.payload.error.data.connector.oneCommandClientInstallJson);
  assert.match(unauthenticatedList.payload.error.data.connector.oneCommandClientInstallJsonZhCN, /pact-mcp-install\.zh-CN\.sh.+--target <client>/);
  assert.equal(unauthenticatedList.payload.error.data.connector.githubOneLineClientInstallJsonCommandZhCN, unauthenticatedList.payload.error.data.connector.oneCommandClientInstallJsonZhCN);
  assert.match(unauthenticatedList.payload.error.data.connector.oneCommandAutoInstall, /pact-mcp-install\.sh.+--target auto/);
  assert.equal(unauthenticatedList.payload.error.data.connector.githubOneLineAutoInstallCommand, unauthenticatedList.payload.error.data.connector.oneCommandAutoInstall);
  assert.match(unauthenticatedList.payload.error.data.connector.oneCommandAutoInstallZhCN, /pact-mcp-install\.zh-CN\.sh.+--target auto/);
  assert.equal(unauthenticatedList.payload.error.data.connector.githubOneLineAutoInstallCommandZhCN, unauthenticatedList.payload.error.data.connector.oneCommandAutoInstallZhCN);
  assert.equal(unauthenticatedList.payload.error.data.nextCommand, unauthenticatedList.payload.error.data.connector.oneCommandAutoInstall);
  assert.equal(unauthenticatedList.payload.error.data.nextCommandZhCN, unauthenticatedList.payload.error.data.connector.oneCommandAutoInstallZhCN);
  assert.equal(unauthenticatedList.payload.error.data.localGrantEndpoint, `${server.url}/api/mcp/local-grant`);
  assert.deepEqual(unauthenticatedList.payload.error.data.priorityTargets, ["claude-code", "codex", "openclaw"]);
  assert.ok(unauthenticatedList.payload.error.data.repairCommands.includes(unauthenticatedList.payload.error.data.connector.oneCommandAutoInstall));
  assert.ok(unauthenticatedList.payload.error.data.repairCommands.includes(unauthenticatedList.payload.error.data.connector.oneCommandAutoInstallZhCN));
  assert.ok(unauthenticatedList.payload.error.data.repairCommands.includes(unauthenticatedList.payload.error.data.connector.oneCommandPriorityInstallZhCN));
  assert.ok(unauthenticatedList.payload.error.data.repairCommands.includes(unauthenticatedList.payload.error.data.connector.autoInstallCommand));

  const unauthenticatedCall = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mcpRequest("tools/call", {
      name: "pact.discovery",
      arguments: {
        apiVersion: "pact.mcp.v1",
        operation: "pact.mcp.version"
      }
    }, 20))
  });
  assert.equal(unauthenticatedCall.status, 401);
  assert.equal(unauthenticatedCall.payload.error.data.code, "missing_token");
  assert.equal(
    unauthenticatedCall.payload.error.data.connector.priorityInstallCommand,
    `npx pact-mcp-connector@latest install --target claude-code,codex,openclaw --url '${server.url}' --json`
  );
  assert.equal(unauthenticatedCall.payload.error.data.nextCommandZhCN, unauthenticatedCall.payload.error.data.connector.oneCommandAutoInstallZhCN);
  assert.ok(unauthenticatedCall.payload.error.data.repairCommands.includes(unauthenticatedCall.payload.error.data.connector.oneCommandPriorityInstall));
  assert.ok(unauthenticatedCall.payload.error.data.repairCommands.includes(unauthenticatedCall.payload.error.data.connector.oneCommandPriorityInstallZhCN));

  const unknownMethodProbe = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mcpRequest("unknown /home/private-user/report.txt --token rpc_private_token", {}, 21))
  });
  assert.equal(unknownMethodProbe.status, 200);
  assert.match(unknownMethodProbe.payload.error.message, /\[server-internal-path\]/);
  assert.match(unknownMethodProbe.payload.error.message, /--token <redacted-token>/);
  assert.equal(JSON.stringify(unknownMethodProbe.payload).includes("rpc_private_token"), false);
  assertNoMcpInternalLeak(unknownMethodProbe.payload, "MCP unknown method error");

  const mcpDeniedRequests = await fetchJson(`${server.url}/api/authorization/denied-requests?limit=20`);
  assert.equal(mcpDeniedRequests.status, 200);
  assert.ok(
    mcpDeniedRequests.payload.items.some((item) =>
      item.operationId === "mcp.request" && item.reasonCode === "missing_token"
    ),
    "MCP token denials must be recorded in the unified authorization store"
  );

  const localGrant = await fetchJson(`${server.url}/api/mcp/local-grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targets: ["codex"],
      label: "verify-mcp-local-grant",
      connectorVersion: "verify"
    })
  });
  assert.equal(localGrant.status, 201);
  assert.equal(localGrant.payload.ok, true);
  assert.ok(localGrant.payload.token);
  assert.ok(localGrant.payload.grant.tokenPrefix);
  assert.deepEqual(localGrant.payload.targets, ["codex"]);
  assert.equal(localGrant.payload.maxRisk, "safe_write");
  assert.equal(localGrant.payload.targetMatch.matched, true);
  assert.deepEqual(localGrant.payload.priorityTargets, ["claude-code", "codex", "openclaw"]);
  assert.deepEqual(localGrant.payload.supportedTargets, expectedInstallTargets);
  assert.match(localGrant.payload.connector.githubOneLineCommand, /pact-mcp-install\.sh/);
  assert.match(localGrant.payload.connector.githubOneLineCommand, /curl -fL --retry 3 --connect-timeout 20 -sS/);
  assert.equal(localGrant.payload.connector.githubOneLineCommandZhCN, RELEASE_BOOTSTRAP_ZH_CN);
  assert.equal(
    localGrant.payload.connector.githubOneLineAutoInstallCommand,
    `${RELEASE_BOOTSTRAP} -- --target auto --url '${server.url}' --json`
  );
  assert.equal(
    localGrant.payload.connector.githubOneLineAutoInstallCommandZhCN,
    `${RELEASE_BOOTSTRAP_ZH_CN} -- --target auto --url '${server.url}' --json`
  );
  assert.equal(
    localGrant.payload.connector.githubOneLinePriorityInstallCommand,
    `${RELEASE_BOOTSTRAP} -- --target claude-code,codex,openclaw --url '${server.url}' --json`
  );
  assert.equal(
    localGrant.payload.connector.githubOneLinePriorityInstallCommandZhCN,
    `${RELEASE_BOOTSTRAP_ZH_CN} -- --target claude-code,codex,openclaw --url '${server.url}' --json`
  );
  assert.equal(localGrant.payload.connector.oneCommandAutoInstall, localGrant.payload.connector.githubOneLineAutoInstallCommand);
  assert.equal(localGrant.payload.connector.oneCommandAutoInstallZhCN, localGrant.payload.connector.githubOneLineAutoInstallCommandZhCN);
  assert.equal(localGrant.payload.connector.oneCommandPriorityInstall, localGrant.payload.connector.githubOneLinePriorityInstallCommand);
  assert.equal(localGrant.payload.connector.oneCommandPriorityInstallZhCN, localGrant.payload.connector.githubOneLinePriorityInstallCommandZhCN);
  assert.equal(localGrant.payload.connector.oneCommandClientInstallJson, localGrant.payload.connector.githubOneLineClientInstallJsonCommand);
  assert.equal(localGrant.payload.connector.oneCommandClientInstallJsonZhCN, localGrant.payload.connector.githubOneLineClientInstallJsonCommandZhCN);
  assert.equal(
    localGrant.payload.connector.autoInstallCommand,
    `npx pact-mcp-connector@latest install --target auto --url '${server.url}' --json`
  );
  assert.equal(
    localGrant.payload.connector.priorityInstallCommand,
    `npx pact-mcp-connector@latest install --target claude-code,codex,openclaw --url '${server.url}' --json`
  );
  assert.equal(
    localGrant.payload.connector.discoverCommand,
    `npx pact-mcp-connector@latest discover-local --url '${server.url}' --json`
  );
  assert.equal(
    localGrant.payload.connector.clientInstallJsonCommand,
    `npx pact-mcp-connector@latest install --target <client> --url '${server.url}' --json`
  );
  assert.equal(localGrant.payload.connector.scanCommand, `npx pact-mcp-connector@latest scan --url '${server.url}' --json`);
  assert.equal(localGrant.payload.connector.doctorCommand, `npx pact-mcp-connector@latest doctor --url '${server.url}' --json`);
  const localGrantTargetDetails = new Map(localGrant.payload.supportedTargetDetails.map((target) => [target.target, target]));
  assert.deepEqual([...localGrantTargetDetails.keys()], expectedInstallTargets);
  assert.equal(localGrantTargetDetails.get("codex").agentProfileId, "pact.mcp.codex");
  assert.equal(localGrantTargetDetails.get("opencode").maxRisk, "safe_write");
  assert.equal(localGrant.payload.sharedHub.canonicalMcpUrl, `${server.url}/mcp`);
  assert.match(localGrant.payload.sharedHub.vmMcpUrl, /host\.orb\.internal:\d+\/mcp$/);
  assert.equal(localGrant.payload.sharedHub.sharedspace.outlet, "pact.sharedspace");
  assert.equal(localGrant.payload.sharedHub.sharedspace.referencePolicy, "use-public-workspace-ref");
  assert.equal(localGrant.payload.sharedHub.sharedspace.exchangeReceipt.schemaVersion, "pact.mcp.sharedspace-exchange.v1");
  assert.ok(localGrant.payload.sharedHub.sharedspace.exchangeReceipt.locations.includes("structuredContent.exchange"));
  assert.ok(localGrant.payload.sharedHub.sharedspace.exchangeReceipt.fields.includes("referencePolicy"));
  assert.ok(localGrant.payload.sharedHub.sharedspace.exchangeReceipt.fields.includes("syncReceiptId"));
  assert.ok(localGrant.payload.sharedHub.sharedspace.coreOperations.includes("pact.sharedspace.file.write"));
  assert.ok(localGrant.payload.sharedHub.sharedspace.coreOperations.includes("pact.sharedspace.drive.sync.apply"));
  assert.equal(localGrant.payload.targetMatch.matchedTargetDetails[0].agentProfileId, "pact.mcp.codex");
  assert.equal(localGrant.payload.targetMatch.matchedTargetDetails[0].toolsets.includes("pact.agent.workspace"), true);
  assert.equal(localGrant.payload.toolsets.includes("pact.storage.write"), true);
  assert.equal(localGrant.payload.toolsets.includes("pact.agent.workspace"), true);

  const skillPackageRegistry = createCapabilityPackageRegistry({ userDataPath });
  const visibleSkillManifest = signedManifest({
    kind: "skill",
    name: "mcp-discovery-visible-skill",
    version: "1.0.0",
    title: "MCP Discovery Visible Skill",
    description: "Verifies active skill package projection into pact.discovery.",
    owner: "verification",
    source: "skill-hub-upload",
    capabilities: ["skill.discovery.visible"],
    risk: "read_only",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    sandbox: { policy: "knowledge-only" },
    license: "MIT"
  });
  const visibleSkill = await skillPackageRegistry.submit({
    manifest: visibleSkillManifest,
    files: [{ path: "SKILL.md", content: "# MCP Discovery Visible Skill\n" }]
  }, { submittedBy: "mcp-verifier" });
  await skillPackageRegistry.lifecycle(visibleSkill.record.manifest.packageId, { action: "approve", actor: "mcp-verifier" });
  await skillPackageRegistry.lifecycle(visibleSkill.record.manifest.packageId, { action: "install", actor: "mcp-verifier" });
  await skillPackageRegistry.lifecycle(visibleSkill.record.manifest.packageId, { action: "activate", actor: "mcp-verifier" });

  const unknownTargetGrant = await fetchJson(`${server.url}/api/mcp/local-grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targets: ["unknown-agent"],
      label: "verify-mcp-local-grant-unknown-target"
    })
  });
  assert.equal(unknownTargetGrant.status, 201);
  assert.equal(unknownTargetGrant.payload.ok, true);
  assert.equal(unknownTargetGrant.payload.maxRisk, "read_only");
  assert.equal(unknownTargetGrant.payload.targetMatch.matched, false);
  assert.deepEqual(unknownTargetGrant.payload.supportedTargets, expectedInstallTargets);
  assert.deepEqual(unknownTargetGrant.payload.targetMatch.matchedTargetDetails, []);
  assert.equal(unknownTargetGrant.payload.sharedHub.sharedspace.exchangeReceipt.schemaVersion, "pact.mcp.sharedspace-exchange.v1");
  assert.equal(unknownTargetGrant.payload.toolsets.includes("pact.storage.write"), false);

  const explicitScopeGrant = await fetchJson(`${server.url}/api/mcp/local-grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pact-safety-confirm": "true" },
    body: JSON.stringify({
      targets: ["codex"],
      label: "verify-mcp-local-grant-explicit-scope",
      scopes: ["storage:write"]
    })
  });
  assert.equal(explicitScopeGrant.status, 201);
  assert.equal(explicitScopeGrant.payload.ok, true);
  assert.equal(explicitScopeGrant.payload.scopes.includes("storage:write"), true);
  assert.equal(explicitScopeGrant.payload.toolsets.includes("pact.storage.write"), true);

  const unconfirmedWriteGrant = await fetchJson(`${server.url}/api/mcp/local-grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pact-safety-confirm": "false" },
    body: JSON.stringify({
      targets: ["codex"],
      label: "verify-mcp-local-grant-unconfirmed-write-scope",
      scope: "storage:write"
    })
  });
  assert.equal(unconfirmedWriteGrant.status, 403);
  assert.equal(unconfirmedWriteGrant.payload.error.code, "confirmation_required");

  const explicitToolsetGrant = await fetchJson(`${server.url}/api/mcp/local-grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pact-safety-confirm": "true" },
    body: JSON.stringify({
      targets: ["codex"],
      label: "verify-mcp-local-grant-explicit-toolset",
      toolsets: ["pact.storage.write"]
    })
  });
  assert.equal(explicitToolsetGrant.status, 201);
  assert.equal(explicitToolsetGrant.payload.ok, true);
  assert.equal(explicitToolsetGrant.payload.toolsets.includes("pact.storage.write"), true);

  const expectedTools = ["pact.discovery", "pact.knowledge", "pact.sharedspace", "pact.codespace", "pact.skillHub"];

  const localGrantList = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(localGrant.payload.token),
    body: JSON.stringify(mcpRequest("tools/list", {}, 30))
  });
  assert.equal(localGrantList.status, 200);
  assert.equal(localGrantList.payload.result.tools.length, 5);
  for (const name of expectedTools) {
    assert.ok(localGrantList.payload.result.tools.some(t => t.name === name));
  }

  const localGrantBearerList = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: bearerHeaders(localGrant.payload.token),
    body: JSON.stringify(mcpRequest("tools/list", {}, 31))
  });
  assert.equal(localGrantBearerList.status, 200);
  assert.equal(localGrantBearerList.payload.result.tools.length, 5);
  assert.equal(localGrantBearerList.payload.result._meta.stableToolName, "pact.call");
  assert.equal(localGrantBearerList.payload.result._meta.sharedHub.canonicalMcpUrl, `${server.url}/mcp`);
  assert.equal(localGrantBearerList.payload.result._meta.sharedHub.sharedspace.outlet, "pact.sharedspace");
  assert.equal(
    localGrantBearerList.payload.result._meta.connector.autoInstallCommand,
    `npx pact-mcp-connector@latest install --target auto --url '${server.url}' --json`
  );
  assert.equal(
    localGrantBearerList.payload.result._meta.connector.priorityInstallCommand,
    `npx pact-mcp-connector@latest install --target claude-code,codex,openclaw --url '${server.url}' --json`
  );
  assert.match(localGrantBearerList.payload.result._meta.connector.oneCommandAutoInstall, /pact-mcp-install\.sh.+--target auto/);
  assert.equal(localGrantBearerList.payload.result._meta.connector.githubOneLineAutoInstallCommand, localGrantBearerList.payload.result._meta.connector.oneCommandAutoInstall);
  assert.match(localGrantBearerList.payload.result._meta.connector.oneCommandAutoInstallZhCN, /pact-mcp-install\.zh-CN\.sh.+--target auto/);
  assert.equal(localGrantBearerList.payload.result._meta.connector.githubOneLineAutoInstallCommandZhCN, localGrantBearerList.payload.result._meta.connector.oneCommandAutoInstallZhCN);
  assert.deepEqual(localGrantBearerList.payload.result._meta.priorityTargets, ["claude-code", "codex", "openclaw"]);
  assert.deepEqual(localGrantBearerList.payload.result._meta.supportedTargets.map((target) => target.target), expectedInstallTargets);

  const versionProbe = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(localGrant.payload.token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: "pact.discovery",
      arguments: {
        apiVersion: "pact.mcp.v1",
        operation: "pact.mcp.version"
      }
    }, 314))
  });
  assert.equal(versionProbe.status, 200);
  assert.equal(versionProbe.payload.result.structuredContent.stableToolName, "pact.call");
  assert.equal(versionProbe.payload.result.structuredContent.sharedHub.canonicalMcpUrl, `${server.url}/mcp`);
  assert.equal(versionProbe.payload.result.structuredContent.sharedHub.sharedspace.outlet, "pact.sharedspace");
  assert.deepEqual(versionProbe.payload.result.structuredContent.supportedTargets.map((target) => target.target), expectedInstallTargets);

  const updateProbe = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(localGrant.payload.token),
    body: JSON.stringify(mcpToolCall("pact.discovery", "pact.update", {
      clientVersion: "verify-mcp-http-old"
    }, 315))
  });
  assert.equal(updateProbe.status, 200);
  const updateCommand = updateProbe.payload.result.structuredContent.installCommand;
  assert.equal(updateProbe.payload.result.structuredContent.updateAvailable, true);
  assert.equal(updateProbe.payload.result.structuredContent.autoUpdate, false);
  assert.equal(updateProbe.payload.result.structuredContent.autoInstallCommand, updateCommand);
  assert.match(updateCommand, /pact-mcp-install\.sh.+--target auto/);
  assert.match(updateCommand, /--json/);
  assert.match(updateCommand, new RegExp(`--url '${server.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert.match(updateProbe.payload.result.structuredContent.installCommandZhCN, /pact-mcp-install\.zh-CN\.sh.+--target auto/);
  assert.equal(updateProbe.payload.result.structuredContent.autoInstallCommandZhCN, updateProbe.payload.result.structuredContent.installCommandZhCN);
  assert.match(updateProbe.payload.result.structuredContent.oneCommandClientInstallJson, /pact-mcp-install\.sh.+--target <client>/);
  assert.match(updateProbe.payload.result.structuredContent.oneCommandClientInstallJson, /--json/);
  assert.match(updateProbe.payload.result.structuredContent.oneCommandClientInstallJsonZhCN, /pact-mcp-install\.zh-CN\.sh.+--target <client>/);
  assert.match(updateProbe.payload.result.structuredContent.oneCommandClientInstallJsonZhCN, /--json/);
  assert.equal(
    updateProbe.payload.result.structuredContent.clientInstallJsonCommand,
    `npx pact-mcp-connector@latest install --target <client> --url '${server.url}' --json`
  );
  assert.equal(
    updateProbe.payload.result.structuredContent.connector.clientInstallJsonCommand,
    `npx pact-mcp-connector@latest install --target <client> --url '${server.url}' --json`
  );
  assert.match(updateProbe.payload.result.structuredContent.priorityInstallCommand, /pact-mcp-install\.sh.+--target claude-code,codex,openclaw/);
  assert.match(updateProbe.payload.result.structuredContent.priorityInstallCommand, /--json/);
  assert.match(updateProbe.payload.result.structuredContent.priorityInstallCommandZhCN, /pact-mcp-install\.zh-CN\.sh.+--target claude-code,codex,openclaw/);
  assert.match(updateProbe.payload.result.structuredContent.priorityInstallCommandZhCN, /--json/);
  assert.deepEqual(updateProbe.payload.result.structuredContent.priorityTargets, ["claude-code", "codex", "openclaw"]);
  const updateTargetDetails = new Map(updateProbe.payload.result.structuredContent.supportedTargets.map((target) => [target.target, target]));
  assert.deepEqual([...updateTargetDetails.keys()], expectedInstallTargets);
  assert.equal(updateTargetDetails.get("claude-code").label, "Claude Code");
  assert.equal(updateTargetDetails.get("openclaw").priority, true);
  assert.deepEqual(updateTargetDetails.get("hermes").locations, ["orbstack", "remote-linux"]);
  assert.equal(updateProbe.payload.result.structuredContent.sharedHub.canonicalMcpUrl, `${server.url}/mcp`);
  assert.equal(updateProbe.payload.result.structuredContent.sharedHub.sharedspace.outlet, "pact.sharedspace");
  assert.equal(updateProbe.payload.result.structuredContent.sharedHub.sharedspace.exchangeReceipt.schemaVersion, "pact.mcp.sharedspace-exchange.v1");
  assert.match(updateProbe.payload.result.structuredContent.priorityInstallCommand, new RegExp(`--url '${server.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert.match(updateProbe.payload.result.content[0].text, new RegExp(`--url '${server.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert.match(updateProbe.payload.result.content[0].text, /claude-code,codex,openclaw/);

  const localGrantCapabilities = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(localGrant.payload.token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: "pact.discovery",
      arguments: {
        apiVersion: "pact.mcp.v1",
        operation: "pact.capabilities.list"
      }
    }, 32))
  });
  assert.equal(localGrantCapabilities.status, 200);
  const localOperations = localGrantCapabilities.payload.result.structuredContent.operations;
  const localOutlets = localGrantCapabilities.payload.result.structuredContent.outlets;
  const localSkillCatalog = localGrantCapabilities.payload.result.structuredContent.skillCatalog;
  assert.equal(localGrantCapabilities.payload.result.structuredContent.sharedHub.canonicalMcpUrl, `${server.url}/mcp`);
  assert.equal(localGrantCapabilities.payload.result.structuredContent.sharedHub.sharedspace.outlet, "pact.sharedspace");
  assert.equal(localGrantCapabilities.payload.result.structuredContent.sharedHub.sharedspace.exchangeReceipt.schemaVersion, "pact.mcp.sharedspace-exchange.v1");
  assert.ok(localGrantCapabilities.payload.result.structuredContent.sharedHub.sharedspace.coreOperations.includes("pact.sharedspace.file.write"));
  assert.ok(localGrantCapabilities.payload.result.structuredContent.sharedHub.sharedspace.coreOperations.includes("pact.sharedspace.drive.file.upload"));
  assert.equal(
    localGrantCapabilities.payload.result.structuredContent.connector.clientInstallJsonCommand,
    `npx pact-mcp-connector@latest install --target <client> --url '${server.url}' --json`
  );
  assert.equal(localGrantCapabilities.payload.result.structuredContent.connector.scanCommand, `npx pact-mcp-connector@latest scan --url '${server.url}' --json`);
  assert.deepEqual(localGrantCapabilities.payload.result.structuredContent.priorityTargets, ["claude-code", "codex", "openclaw"]);
  assert.deepEqual(localGrantCapabilities.payload.result.structuredContent.supportedTargets.map((target) => target.target), expectedInstallTargets);
  const operationByName = new Map(localOperations.map((operation) => [operation.name, operation]));
  assert.equal(operationByName.get("pact.sharedspace.file.write")._meta.mcpOutlet, "pact.sharedspace");
  assert.equal(operationByName.get("pact.sharedspace.file.write")._meta.exchangeReceipt.schemaVersion, "pact.mcp.sharedspace-exchange.v1");
  assert.ok(operationByName.get("pact.sharedspace.file.write")._meta.exchangeReceipt.locations.includes("structuredContent.exchange"));
  assert.ok(operationByName.get("pact.sharedspace.file.write")._meta.exchangeReceipt.fields.includes("checkpointId"));
  assert.equal(operationByName.get("pact.repo.status")._meta.mcpOutlet, "pact.codespace");
  assert.equal(operationByName.get("pact.knowledge.skills.list")._meta.mcpOutlet, "pact.skillHub");
  assert.equal(operationByName.get("pact.knowledge.search")._meta.mcpOutlet, "pact.knowledge");
  assert.equal(localSkillCatalog.summary.activeSkillCount, 1);
  assert.equal(localSkillCatalog.summary.visibleSkillCount, 1);
  assert.equal(localSkillCatalog.skills[0].name, "mcp-discovery-visible-skill");
  assert.equal(localSkillCatalog.skills[0].mcpOutlet, "pact.skillHub");
  assert.equal(localSkillCatalog.skills[0].library.storage, "server-skill-library");
  assert.equal(Object.prototype.hasOwnProperty.call(localSkillCatalog.skills[0].library, "absolutePath"), false);
  assert.equal(JSON.stringify(localSkillCatalog).includes("MCP Discovery Visible Skill\\n"), false);
  assert.ok(localOutlets["pact.sharedspace"].operations.includes("pact.sharedspace.file.write"));
  assert.equal(localOutlets["pact.sharedspace"].exchangeReceipt.schemaVersion, "pact.mcp.sharedspace-exchange.v1");
  assert.ok(localOutlets["pact.sharedspace"].exchangeReceipt.actions.includes("file-written"));
  assert.ok(localOutlets["pact.sharedspace"].exchangeReceipt.actions.includes("drive-sync-applied"));
  assert.ok(localOutlets["pact.codespace"].operations.includes("pact.repo.status"));
  assert.ok(localOutlets["pact.skillHub"].operations.includes("pact.knowledge.skills.list"));
  assert.equal(localOutlets["pact.skillHub"].skillCatalog.visibleSkillCount, 1);
  assert.ok(localOutlets["pact.knowledge"].operations.includes("pact.knowledge.search"));

  const mismatchedOutletCall = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(localGrant.payload.token),
    body: JSON.stringify(mcpToolCall("pact.knowledge", "pact.sharedspace.file.write", {
      workspaceRef: "workspace-1",
      path: "notes/hello.txt",
      content: "wrong outlet"
    }, 33))
  });
  assert.equal(mismatchedOutletCall.status, 200);
  assert.equal(mismatchedOutletCall.payload.error.data.code, "operation_outlet_mismatch");
  assert.equal(mismatchedOutletCall.payload.error.data.requestedTool, "pact.knowledge");
  assert.equal(mismatchedOutletCall.payload.error.data.expectedTool, "pact.sharedspace");
  assert.equal(mismatchedOutletCall.payload.error.data.example.name, "pact.sharedspace");

  const sharedspaceGrant = await fetchJson(`${server.url}/api/mcp/local-grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targets: ["codex"],
      label: "verify-mcp-sharedspace-flow",
      connectorVersion: "verify"
    })
  });
  assert.equal(sharedspaceGrant.status, 201);
  assert.equal(sharedspaceGrant.payload.ok, true);

  const createdSharedWorkspace = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(sharedspaceGrant.payload.token),
    body: JSON.stringify(mcpToolCall("pact.sharedspace", "pact.agentWorkspace.create", {
      title: "MCP sharedspace exchange",
      objective: "Verify agent-to-agent file exchange through Pact MCP"
    }, 34))
  });
  assert.equal(createdSharedWorkspace.status, 200);
  const createdWorkspacePayload = createdSharedWorkspace.payload.result.structuredContent.payload;
  const workspaceRef = createdWorkspacePayload.workspace.workspaceRef;
  const createdExchange = createdSharedWorkspace.payload.result.structuredContent.exchange;
  assert.equal(workspaceRef, "workspace-1");
  assert.equal(createdExchange.schemaVersion, "pact.mcp.sharedspace-exchange.v1");
  assert.equal(createdExchange.action, "workspace-created");
  assert.equal(createdExchange.outlet, "pact.sharedspace");
  assert.equal(createdExchange.referencePolicy, "use-public-workspace-ref");
  assert.equal(createdExchange.workspaceRef, workspaceRef);

  let sharedspaceWrite = null;
  const sharedspaceWriteSse = await captureMcpSseDuring({
    url: `${server.url}/mcp`,
    headers: apiKeyHeaders(sharedspaceGrant.payload.token),
    until: (text) =>
      text.includes("notifications/pact/operation_reply") &&
        text.includes("pact.sharedspace.file.write") &&
        text.includes("\"status\":\"completed\""),
    action: async () => {
      sharedspaceWrite = await fetchJson(`${server.url}/mcp`, {
        method: "POST",
        headers: apiKeyHeaders(sharedspaceGrant.payload.token),
        body: JSON.stringify(mcpToolCall("pact.sharedspace", "pact.sharedspace.file.write", {
          workspaceRef,
          path: "notes/hello.txt",
          content: "hello pact"
        }, 35))
      });
    }
  });
  assert.match(sharedspaceWriteSse.text, /notifications\/pact\/operation_reply/);
  assert.match(sharedspaceWriteSse.text, /pact\.sharedspace\.file\.write/);
  assert.match(sharedspaceWriteSse.text, /"status":"completed"/);
  assert.match(sharedspaceWriteSse.text, /"exchange":\{"schemaVersion":"pact\.mcp\.sharedspace-exchange\.v1"/);
  assert.match(sharedspaceWriteSse.text, /"action":"file-written"/);
  assert.match(sharedspaceWriteSse.text, /"path":"notes\/hello\.txt"/);
  assert.equal(sharedspaceWrite.status, 200);
  const writePayload = sharedspaceWrite.payload.result.structuredContent.payload;
  const writeExchange = sharedspaceWrite.payload.result.structuredContent.exchange;
  assert.equal(writePayload.ok, true);
  assert.equal(writePayload.file.relativePath, "notes/hello.txt");
  assert.equal(writeExchange.action, "file-written");
  assert.equal(writeExchange.outlet, "pact.sharedspace");
  assert.equal(writeExchange.referencePolicy, "use-public-workspace-ref");
  assert.equal(writeExchange.workspaceRef, workspaceRef);
  assert.equal(writeExchange.path, "notes/hello.txt");
  assert.ok(writeExchange.nextOperations.includes("pact.sharedspace.file.read"));

  const sharedspaceList = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(sharedspaceGrant.payload.token),
    body: JSON.stringify(mcpToolCall("pact.sharedspace", "pact.sharedspace.item.list", {
      workspaceRef,
      path: "notes"
    }, 36))
  });
  assert.equal(sharedspaceList.status, 200);
  const listPayload = sharedspaceList.payload.result.structuredContent.payload;
  const listExchange = sharedspaceList.payload.result.structuredContent.exchange;
  assert.equal(listPayload.ok, true);
  assert.ok(listPayload.paths.includes("notes/hello.txt"));
  assert.equal(listExchange.action, "items-listed");
  assert.equal(listExchange.itemCount, listPayload.paths.length);
  assert.ok(listExchange.paths.includes("notes/hello.txt"));

  const sharedspaceRead = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(sharedspaceGrant.payload.token),
    body: JSON.stringify(mcpToolCall("pact.sharedspace", "pact.sharedspace.file.read", {
      workspaceRef,
      path: "notes/hello.txt",
      includeText: true
    }, 37))
  });
  assert.equal(sharedspaceRead.status, 200);
  const readPayload = sharedspaceRead.payload.result.structuredContent.payload;
  const readExchange = sharedspaceRead.payload.result.structuredContent.exchange;
  assert.equal(readPayload.ok, true);
  assert.equal(readPayload.content, "hello pact");
  assert.equal(readExchange.action, "file-read");
  assert.equal(readExchange.path, "notes/hello.txt");
  const sharedspaceJson = JSON.stringify({
    createdWorkspacePayload,
    createdExchange,
    writePayload,
    writeExchange,
    listPayload,
    listExchange,
    readPayload,
    readExchange
  });
  assertNoMcpInternalLeak(sharedspaceJson, "MCP sharedspace output");

  let failedSharedspaceRead = null;
  const failedSharedspaceReadSse = await captureMcpSseDuring({
    url: `${server.url}/mcp`,
    headers: apiKeyHeaders(sharedspaceGrant.payload.token),
    until: (text) =>
      text.includes("notifications/pact/operation_reply") &&
        text.includes("pact.sharedspace.file.read") &&
        text.includes("\"status\":\"failed\""),
    action: async () => {
      failedSharedspaceRead = await fetchJson(`${server.url}/mcp`, {
        method: "POST",
        headers: apiKeyHeaders(sharedspaceGrant.payload.token),
        body: JSON.stringify(mcpToolCall("pact.sharedspace", "pact.sharedspace.file.read", {
          workspaceId: "workspace_private_http_probe",
          path: "/home/private-user/private.txt",
          includeText: true
        }, 38))
      });
    }
  });
  assert.equal(failedSharedspaceRead.status, 200);
  assert.ok(failedSharedspaceRead.payload.error);
  assert.equal(failedSharedspaceRead.payload.error.data.exchange.schemaVersion, "pact.mcp.sharedspace-exchange.v1");
  assert.equal(failedSharedspaceRead.payload.error.data.exchange.action, "file-read");
  assert.equal(failedSharedspaceRead.payload.error.data.exchange.path, "[server-internal-path]");
  assert.equal(failedSharedspaceRead.payload.error.data.target.targetKind, "sharedspace");
  assert.equal(failedSharedspaceRead.payload.error.data.target.workspaceId, "workspace-hidden");
  assert.match(failedSharedspaceReadSse.text, /"exchange":\{"schemaVersion":"pact\.mcp\.sharedspace-exchange\.v1"/);
  assert.match(failedSharedspaceReadSse.text, /"action":"file-read"/);
  assert.match(failedSharedspaceReadSse.text, /"path":"\[server-internal-path\]"/);
  assertNoMcpInternalLeak(failedSharedspaceRead.payload, "MCP failed sharedspace response");
  assertNoMcpInternalLeak(failedSharedspaceReadSse.text, "MCP failed sharedspace SSE");

  const grant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-mcp-http",
      scopes: ["storage:read"]
    })
  });
  assert.equal(grant.status, 201);
  assert.ok(grant.payload.token);

  const list = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(grant.payload.token),
    body: JSON.stringify(mcpRequest("tools/list", {}, 3))
  });
  assert.equal(list.status, 200);
  assert.equal(list.payload.result.tools.length, 5);
  for (const name of expectedTools) {
    assert.ok(list.payload.result.tools.some(t => t.name === name));
  }
  assert.equal(list.payload.result._meta.stableToolName, "pact.call");

  const health = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(grant.payload.token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: "pact.call",
      arguments: {
        apiVersion: "pact.mcp.v1",
        operation: "system.health",
        input: {}
      }
    }, 4))
  });
  assert.equal(health.status, 200);
  assert.equal(health.payload.result.content[0].type, "text");
  assert.equal(health.payload.result.structuredContent.operation, "system.health");
  assert.equal(health.payload.result.structuredContent.payload.ok, true);

  const internalEnvelopeProbe = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(grant.payload.token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: "pact.call",
      arguments: {
        apiVersion: "pact.mcp.v1",
        operation: "system.health",
        input: {},
        workspaceId: "workspace_private_envelope_probe",
        operatorId: "/home/private-user/agent",
        intent: "inspect /home/private-user/report.txt with Authorization: Bearer envelope_private_token and apiKey=envelope_private_token",
        subject: {
          token: "envelope_private_token",
          tokenPrefix: "envelope_private",
          secretRef: "secret://pact/mcp/envelope",
          headers: {
            Authorization: "Bearer envelope_private_token",
            "X-Pact-Api-Key": "envelope_private_token",
            Accept: "application/json"
          }
        }
      }
    }, 39))
  });
  assert.equal(internalEnvelopeProbe.status, 200);
  assert.equal(internalEnvelopeProbe.payload.result.structuredContent.envelope.workspaceId, "workspace-hidden");
  assert.equal(internalEnvelopeProbe.payload.result.structuredContent.envelope.operatorId, "[server-internal-path]");
  assert.equal(
    internalEnvelopeProbe.payload.result.structuredContent.envelope.intent,
    "inspect [server-internal-path] with Authorization: Bearer <redacted-token> and apiKey=<redacted-secret>"
  );
  assert.equal(Object.prototype.hasOwnProperty.call(internalEnvelopeProbe.payload.result.structuredContent.envelope.subject, "token"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(internalEnvelopeProbe.payload.result.structuredContent.envelope.subject, "tokenPrefix"), false);
  assert.equal(internalEnvelopeProbe.payload.result.structuredContent.envelope.subject.secretRef, "secret://pact/mcp/envelope");
  assert.equal(Object.prototype.hasOwnProperty.call(internalEnvelopeProbe.payload.result.structuredContent.envelope.subject.headers, "Authorization"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(internalEnvelopeProbe.payload.result.structuredContent.envelope.subject.headers, "X-Pact-Api-Key"), false);
  assert.equal(internalEnvelopeProbe.payload.result.structuredContent.envelope.subject.headers.Accept, "application/json");
  assertNoMcpInternalLeak(internalEnvelopeProbe.payload, "MCP operation envelope");
  assert.equal(JSON.stringify(internalEnvelopeProbe.payload).includes("envelope_private_token"), false);

  const capabilities = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(grant.payload.token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: "pact.call",
      arguments: {
        apiVersion: "pact.mcp.v1",
        operation: "pact.capabilities.list"
      }
    }, 5))
  });
  assert.equal(capabilities.status, 200);
  assert.ok(capabilities.payload.result.structuredContent.operations.some((tool) => tool.name === "system.health"));

  const unsupportedDirectCall = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(grant.payload.token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: "system.health",
      arguments: {}
    }, 6))
  });
  assert.equal(unsupportedDirectCall.status, 200);
  assert.equal(unsupportedDirectCall.payload.error.data.stableToolName, "pact.call");
  assert.ok(unsupportedDirectCall.payload.error.data.categorizedOutlets.includes("pact.discovery"));

  const mcpMetrics = await fetchJson(`${server.url}/api/tool-management/v1/metrics/summary`);
  assert.equal(mcpMetrics.status, 200);
  assert.ok(mcpMetrics.payload.metrics.requests.byTransport.mcp >= 1);
  assert.ok(mcpMetrics.payload.metrics.requests.byRoute["/mcp"] >= 1);
  assert.ok(mcpMetrics.payload.metrics.requests.requestBytesTotal > 0);
  assert.ok(mcpMetrics.payload.metrics.requests.responseBytesTotal > 0);
  assert.ok(mcpMetrics.payload.metrics.toolCalls.byTool["system.health"] >= 1);
  assert.ok(mcpMetrics.payload.metrics.toolCalls.inputBytesTotal > 0);
  assert.ok(mcpMetrics.payload.metrics.toolCalls.transferBytesTotal > 0);

  const mcpFilteredMetricsUrl = new URL(`${server.url}/api/tool-management/v1/metrics/summary`);
  mcpFilteredMetricsUrl.searchParams.set("transport", "mcp");
  mcpFilteredMetricsUrl.searchParams.set("route", "/mcp");
  mcpFilteredMetricsUrl.searchParams.set("toolId", "system.health");
  mcpFilteredMetricsUrl.searchParams.set("bucketSeconds", "60");
  const mcpFilteredMetrics = await fetchJson(mcpFilteredMetricsUrl.toString());
  assert.equal(mcpFilteredMetrics.status, 200);
  assert.equal(mcpFilteredMetrics.payload.metrics.filters.transport, "mcp");
  assert.equal(mcpFilteredMetrics.payload.metrics.filters.route, "/mcp");
  assert.equal(mcpFilteredMetrics.payload.metrics.filters.toolId, "system.health");
  assert.equal(mcpFilteredMetrics.payload.metrics.series.bucketSeconds, 60);
  assert.ok(mcpFilteredMetrics.payload.metrics.toolCalls.byTool["system.health"] >= 1);
  assert.ok(mcpFilteredMetrics.payload.metrics.requests.byTransport.mcp >= 1);
  assert.ok(mcpFilteredMetrics.payload.metrics.series.buckets.some((bucket) =>
    bucket.toolCalls.byTool["system.health"] >= 1
  ));
  assert.ok(mcpFilteredMetrics.payload.metrics.series.buckets.some((bucket) =>
    bucket.requests.byRoute["/mcp"] >= 1
  ));

  console.log("mcp-http verification passed");
} finally {
  await server.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
