import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeExternalServiceConfig,
  validateExternalServiceConfig
} from "../platform/common/composition-management/external-service-adapter.mjs";
import {
  loadCompositionPresets,
  validateCompositionPreset
} from "../platform/common/composition-management/index.mjs";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SECURITY_DESIGN_PATH = "docs/security/design/0001-local-stdio-interface-lockdown.md";
const DISABLED_EXPORTS = Object.freeze([
  "createAcpSourceStdioServer",
  "createAcpSourceStdioServerOptionsFromEnv",
  "runAcpSourceStdioServerFromEnv"
]);
const FORBIDDEN_SOURCE_STDIO_PACKAGE_SCRIPTS = Object.freeze([
  "server:verify:acp-agent-relay-antigravity-acp-wrapper-target",
  "server:verify:acp-agent-relay-downstream-antigravity-acp-wrapper-target",
  "server:verify:acp-agent-relay-codex-antigravity",
  "server:verify:acp-agent-relay-codex-cli-antigravity",
  "server:verify:acp-agent-relay-codex-cli-antigravity:connect",
  "server:verify:acp-agent-relay-codex-cli-target",
  "server:verify:acp-agent-relay-codex-acp-target",
  "server:verify:acp-agent-relay-downstream-codex-acp-target",
  "server:verify:acp-agent-relay-downstream-opencode-acp-target",
  "server:verify:acp-agent-relay-target-callback-approval",
  "server:verify:acp-agent-relay-target-reconnect",
  "server:verify:acp-agent-relay-target-load-reconnect",
  "server:verify:acp-agent-relay-idempotency",
  "server:verify:acp-agent-relay-real",
  "server:verify:acp-agent-relay-real:connect",
  "server:verify:acp-agent-relay-real:codex-cli",
  "server:verify:acp-agent-relay-real:connect:codex-cli"
]);

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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    payload: text.trim() ? JSON.parse(text) : {}
  };
}

function assertNoPublicLocalStdioExposure(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const processDescriptorPaths = [];
  const visit = (entry, pathParts = []) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, [...pathParts, String(index)]));
      return;
    }
    const pathLabel = pathParts.join(".") || "$";
    if (String(entry.transport || entry.type || "").toLowerCase() === "stdio" || entry.stdioContract) {
      processDescriptorPaths.push(pathLabel);
    }
    if (entry.executable || (entry.command && typeof entry.command === "object")) {
      processDescriptorPaths.push(pathLabel);
    }
    if (typeof entry.command === "string" && (entry.args || entry.cwd || entry.env)) {
      processDescriptorPaths.push(pathLabel);
    }
    for (const [key, item] of Object.entries(entry)) {
      visit(item, [...pathParts, key]);
    }
  };
  visit(value);
  const stdioMatch = /\bstdio\b/i.exec(text);
  assert.equal(
    Boolean(stdioMatch),
    false,
    `${label} must not expose local stdio transport${stdioMatch ? `: ${text.slice(Math.max(0, stdioMatch.index - 120), stdioMatch.index + 120)}` : ""}`
  );
  assert.equal(
    processDescriptorPaths.length > 0,
    false,
    `${label} must not expose local process launch descriptors: ${processDescriptorPaths.join(", ")}`
  );
}

function waitForProcessExit(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out waiting for source stdio process exit after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

function createLineReader(stream) {
  let buffer = "";
  const queue = [];
  const waiters = [];
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n");
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      const waiter = waiters.shift();
      if (waiter) {
        waiter(line);
      } else {
        queue.push(line);
      }
    }
  });
  return {
    receiveLine(timeoutMs = 5000) {
      if (queue.length > 0) {
        return Promise.resolve(queue.shift());
      }
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timed out waiting for source stdio status line.")), timeoutMs);
        waiters.push((line) => {
          clearTimeout(timeout);
          resolve(line);
        });
      });
    }
  };
}

async function assertSecurityDesignSeparation() {
  const packageManifest = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(
    packageManifest.scripts["server:verify:security-local-stdio-lockdown"],
    "node server/scripts/verify-security-local-stdio-lockdown.mjs",
    "Local stdio lockdown must have a dedicated security verifier script"
  );
  assert.match(
    packageManifest.scripts["server:verify:security-hardening"] || "",
    /server:verify:security-local-stdio-lockdown/,
    "Security hardening aggregate must run the local stdio lockdown verifier"
  );
  for (const scriptName of FORBIDDEN_SOURCE_STDIO_PACKAGE_SCRIPTS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(packageManifest.scripts || {}, scriptName),
      false,
      `${scriptName} must not remain in package scripts; source-facing stdio proof paths are removed, not wrapped`
    );
  }
  await assert.rejects(
    () => fs.access(path.join(repoRoot, "server/scripts/retired-source-stdio-verifier.mjs")),
    /ENOENT/,
    "retired-source-stdio-verifier.mjs must not remain as a compatibility wrapper"
  );

  await fs.access(path.join(repoRoot, SECURITY_DESIGN_PATH));
  await assert.rejects(
    () => fs.access(path.join(repoRoot, "docs/adr/0014-local-stdio-interface-lockdown.md")),
    /ENOENT/,
    "Local stdio lockdown must not be recorded under general ADRs"
  );

  const docsReadme = await fs.readFile(path.join(repoRoot, "docs/README.md"), "utf8");
  assert.match(docsReadme, /docs\/security|security\/README\.md/, "Docs index must expose the security design area");

  const securityReadme = await fs.readFile(path.join(repoRoot, "docs/security/README.md"), "utf8");
  assert.match(
    securityReadme,
    /server:verify:security-local-stdio-lockdown[\s\S]*local-stdio-interface-lockdown/,
    "Security README must record the dedicated verifier and production readiness gate id"
  );

  const securityDesign = await fs.readFile(path.join(repoRoot, SECURITY_DESIGN_PATH), "utf8");
  assert.match(
    securityDesign,
    /server:verify:security-local-stdio-lockdown[\s\S]*local-stdio-interface-lockdown/,
    "Security design must record the dedicated verifier and production readiness gate id"
  );

  const productionReadinessGate = await fs.readFile(path.join(repoRoot, "server/scripts/production-readiness-gate.mjs"), "utf8");
  assert.match(
    productionReadinessGate,
    /id:\s*"local-stdio-interface-lockdown"[\s\S]*owner:\s*"security-boundary"[\s\S]*server:verify:security-local-stdio-lockdown/,
    "Production readiness must keep local stdio lockdown as a dedicated security gate"
  );

  const context = await fs.readFile(path.join(repoRoot, "docs/CONTEXT.md"), "utf8");
  assert.match(context, new RegExp(SECURITY_DESIGN_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(context, /docs\/adr\/0014-local-stdio-interface-lockdown\.md/);
}

async function assertSecurityGateSeparation() {
  const externalServiceVerifier = await fs.readFile(path.join(repoRoot, "server/scripts/verify-external-service-api-registration.mjs"), "utf8");
  const mcpHttpVerifier = await fs.readFile(path.join(repoRoot, "server/scripts/verify-mcp-http.mjs"), "utf8");
  const acpRelayVerifier = await fs.readFile(path.join(repoRoot, "server/scripts/verify-acp-agent-relay.mjs"), "utf8");

  assert.doesNotMatch(externalServiceVerifier, /assertLocalStdioInterfacesDisabled|local_stdio_interface_disabled|0014-local-stdio-interface-lockdown/);
  assert.doesNotMatch(mcpHttpVerifier, /assertNoPublicLocalStdioExposure|must not expose local stdio transport/);
  assert.doesNotMatch(acpRelayVerifier, /source_stdio\.disabled|local_stdio_interface_disabled|createAcpSourceStdioServerOptionsFromEnv/);
}

async function assertExternalServiceStdioLockdown() {
  const baseConfig = {
    schemaVersion: "v0.0.1:schema:definition-1",
    kind: "pact.external-service.config",
    serviceId: "verify-security-local-stdio",
    serviceName: "external.verify.security.local-stdio",
    displayName: "Verify Security Local Stdio",
    mode: "connected",
    startupPolicy: "external-only",
    binding: {
      mode: "passthrough",
      outlet: "pact.serviceHub",
      requiredScopes: ["servicehub:invoke"],
      risk: "read_only"
    },
    healthCheck: { type: "none" }
  };

  const acpStdioConfig = normalizeExternalServiceConfig({
    ...baseConfig,
    serviceId: `${baseConfig.serviceId}-acp`,
    upstream: {
      type: "acp",
      transport: "stdio"
    },
    binding: {
      mode: "passthrough",
      outlet: "pact.agentRelay",
      requiredScopes: ["agent_relay:prompt"],
      risk: "repair_write"
    }
  });
  const acpStdioValidation = await validateExternalServiceConfig({
    config: acpStdioConfig,
    requireKnownPaths: false
  });
  assert.equal(acpStdioValidation.ok, false, "ACP stdio external service must be rejected");
  assert.match(JSON.stringify(acpStdioValidation.errors || []), /External ACP stdio upstreams are disabled/);
  assert.doesNotMatch(JSON.stringify(acpStdioValidation.errors || []), /requires upstream\.command\.executable/);

  const serviceHubMcpCommandConfig = normalizeExternalServiceConfig({
    ...baseConfig,
    serviceId: `${baseConfig.serviceId}-mcp-command`,
    policyPreset: "servicehub.development-local",
    templateId: "external-service.template.raw-mcp-streamable-http",
    upstream: {
      type: "mcp",
      transport: "streamable-http",
      url: "http://127.0.0.1:8787/mcp",
      command: {
        executable: process.execPath,
        args: ["server/scripts/local-mcp.mjs"]
      },
      cwd: "/tmp/pact-should-not-leak",
      env: {
        HOME: "/tmp/should-not-leak"
      }
    }
  });
  const serviceHubMcpCommandValidation = await validateExternalServiceConfig({
    config: serviceHubMcpCommandConfig,
    requireKnownPaths: false
  });
  assert.equal(serviceHubMcpCommandValidation.ok, false, "ServiceHub must reject command-backed MCP upstream exposure");
  assert.match(JSON.stringify(serviceHubMcpCommandValidation.errors || []), /must not expose local stdio|must not declare command/);
}

async function assertCompositionAndEntrypointLockdown() {
  const packageManifest = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(
    Object.prototype.hasOwnProperty.call(packageManifest.scripts || {}, "server:acp-agent-relay:source-stdio"),
    false,
    "Pact must not expose a package script that starts a local source-facing stdio interface"
  );

  const activePresets = await loadCompositionPresets({ cwd: repoRoot });
  assert.equal(
    activePresets.some(({ preset }) => preset?.presetId === "acp-agent-relay-source-stdio"),
    false,
    "Retired source stdio composition preset must not load into active composition presets"
  );

  const allPresets = await loadCompositionPresets({ cwd: repoRoot, includeRetired: true });
  const retiredRecord = allPresets.find(({ preset }) => preset?.presetId === "acp-agent-relay-source-stdio");
  assert.ok(retiredRecord, "Retired source stdio composition preset must remain as an audit record");
  assert.equal(retiredRecord.preset.status, "retired", "Source stdio composition preset must be retired");
  assert.equal(
    retiredRecord.preset.retirement?.securityDesign,
    SECURITY_DESIGN_PATH,
    "Source stdio retirement must point to the security design record"
  );

  const validation = await validateCompositionPreset({
    preset: retiredRecord.preset,
    filePath: retiredRecord.filePath,
    cwd: repoRoot
  });
  assert.equal(validation.ok, false, "Retired source stdio composition preset must not validate as deployable");
  assert.match(JSON.stringify(validation.errors || []), /External ACP stdio upstreams are disabled/);

  const child = spawn(process.execPath, ["server/scripts/acp-agent-relay-source-stdio.mjs"], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PACT_ACP_SOURCE_STDIO_RUNTIME_JSON: JSON.stringify({}),
      PACT_ACP_SOURCE_STDIO_CONTEXT_JSON: JSON.stringify({ sourceId: "security-gate", workspaceId: "security" })
    }
  });
  const stderr = createLineReader(child.stderr);
  const disabled = JSON.parse(await stderr.receiveLine());
  assert.equal(disabled.event, "pact.acp.source_stdio.disabled");
  assert.equal(disabled.error?.code, "local_stdio_interface_disabled");
  const exit = await waitForProcessExit(child);
  assert.equal(exit.code, 1);

  const sourceStdioServer = await import("../platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-stdio-server.mjs");
  assert.throws(() => sourceStdioServer.createAcpSourceStdioServer(), /Pact no longer exposes local stdio interfaces/);
  assert.throws(() => sourceStdioServer.createAcpSourceStdioServerOptionsFromEnv(), /Pact no longer exposes local stdio interfaces/);
  const runResult = await sourceStdioServer.runAcpSourceStdioServerFromEnv({ diagnostics: null });
  assert.equal(runResult.ok, false);
  assert.equal(runResult.error.code, "local_stdio_interface_disabled");

  const acpRelayRuntime = await import("../platform/specialized/capabilities/agent-relay/acp-agent-relay/index.mjs");
  for (const disabledExport of DISABLED_EXPORTS) {
    assert.equal(Object.hasOwn(acpRelayRuntime, disabledExport), false, `Runtime index must not export ${disabledExport}`);
  }

  const acpRelayManifest = JSON.parse(await fs.readFile(
    path.join(repoRoot, "server/platform/specialized/capabilities/agent-relay/acp-agent-relay/module.json"),
    "utf8"
  ));
  const manifestExports = new Set(acpRelayManifest.components?.acpAgentRelay?.exports || []);
  for (const disabledExport of DISABLED_EXPORTS) {
    assert.equal(manifestExports.has(disabledExport), false, `Module manifest must not expose ${disabledExport}`);
  }
}

async function assertMcpPublicPayloadLockdown() {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-security-local-stdio-mcp-"));
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
    assertNoPublicLocalStdioExposure(discovery.payload, "MCP discovery payload");

    const initialize = await fetchJson(`${server.url}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mcpRequest("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "verify-security-local-process-lockdown", version: "1" }
      }, 1))
    });
    assert.equal(initialize.status, 200);
    assertNoPublicLocalStdioExposure(initialize.payload.result, "MCP initialize result");

    const grant = await fetchJson(`${server.url}/api/mcp/local-grant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targets: ["codex"],
        label: "verify-security-local-process-lockdown",
        connectorVersion: "security"
      })
    });
    assert.equal(grant.status, 201);
    assert.ok(grant.payload.token);

    const toolsList = await fetchJson(`${server.url}/mcp`, {
      method: "POST",
      headers: apiKeyHeaders(grant.payload.token),
      body: JSON.stringify(mcpRequest("tools/list", {}, 2))
    });
    assert.equal(toolsList.status, 200);
    assertNoPublicLocalStdioExposure(toolsList.payload.result, "MCP tools/list result");

    const capabilities = await fetchJson(`${server.url}/mcp`, {
      method: "POST",
      headers: apiKeyHeaders(grant.payload.token),
      body: JSON.stringify(mcpRequest("tools/call", {
        name: "pact.discovery",
        arguments: {
          apiVersion: "v0.0.1:mcp:interface-1",
          operation: "pact.capabilities.list"
        }
      }, 3))
    });
    assert.equal(capabilities.status, 200);
    assertNoPublicLocalStdioExposure(capabilities.payload.result, "MCP capabilities result");
  } finally {
    await server.close();
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

await assertSecurityDesignSeparation();
await assertSecurityGateSeparation();
await assertExternalServiceStdioLockdown();
await assertCompositionAndEntrypointLockdown();
await assertMcpPublicPayloadLockdown();

console.log("security local stdio lockdown verification passed");
