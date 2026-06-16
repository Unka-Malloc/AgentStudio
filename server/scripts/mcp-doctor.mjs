import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

async function run(command, args = [], options = {}) {
  try {
    const result = await execFileAsync(command, args, { maxBuffer: 1024 * 1024 });
    return { ok: true, stdout: result.stdout || "", stderr: result.stderr || "" };
  } catch (error) {
    if (options.allowFailure) {
      return {
        ok: false,
        stdout: error.stdout || "",
        stderr: error.stderr || error.message || ""
      };
    }
    throw error;
  }
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    payload: text.trim() ? JSON.parse(text) : {}
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

async function readDeviceManifest() {
  const manifestPath = path.join(os.homedir(), ".pact", "mcp", "servers.json");
  try {
    const payload = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const server = payload?.servers?.pact || {};
    const targets = server.targets || {};
    const installedTargets = Object.entries(targets)
      .filter(([, value]) => value?.status === "installed")
      .map(([target]) => target);
    return {
      ok: server.httpUrl === `${baseUrl}/mcp`,
      path: manifestPath,
      exists: true,
      httpUrl: server.httpUrl || "",
      vmHttpUrl: server.vmHttpUrl || "",
      connector: server.connector || null,
      installedTargets,
      targets
    };
  } catch (error) {
    return {
      ok: false,
      path: manifestPath,
      exists: false,
      error: error.message || String(error),
      installedTargets: [],
      targets: {}
    };
  }
}

async function checkOrbStackVm({ vm, user, healthUrl }) {
  const result = await run("orb", [
    "-m",
    vm,
    "-u",
    user,
    "curl",
    "-fsS",
    "--max-time",
    "5",
    healthUrl
  ], { allowFailure: true });
  return {
    ok: result.ok && result.stdout.includes("\"ok\":true"),
    vm,
    user,
    healthUrl,
    skipped: false,
    reason: result.ok ? "" : (result.stderr || result.stdout || "orb check failed").trim()
  };
}

async function discoverSignedBaseUrl() {
  const explicitUrl = String(argValue("--url", process.env.PACT_MCP_BASE_URL || "")).trim();
  const args = ["server/platform/common/mcp/gateway-installer/bin/pact-mcp.mjs", "discover-local", "--json"];
  if (explicitUrl) {
    args.push("--url", explicitUrl);
  }
  const result = await run(process.execPath, args);
  const payload = JSON.parse(result.stdout);
  if (!payload.ok || !payload.baseUrl) {
    throw new Error(payload.reason || "No signed Pact MCP hub discovered.");
  }
  return payload;
}

const signedDiscovery = await discoverSignedBaseUrl();
const baseUrl = String(signedDiscovery.baseUrl).replace(/\/+$/, "");
const token = String(argValue("--token", process.env.PACT_MCP_TOKEN || "")).trim();
const headers = token
  ? {
      "Content-Type": "application/json",
      "X-Pact-Api-Key": token
    }
  : { "Content-Type": "application/json" };

const report = {
  baseUrl,
  signedDiscovery,
  discovery: null,
  initialize: null,
  toolsList: null,
  systemHealth: null,
  deviceManifest: null,
  orbStack: null
};

report.discovery = await jsonFetch(`${baseUrl}/api/mcp/discovery`);
report.initialize = await jsonFetch(`${baseUrl}/mcp`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(mcpRequest("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "pact-mcp-doctor", version: "1" }
  }))
});

if (token) {
  report.toolsList = await jsonFetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(mcpRequest("tools/list", {}, 2))
  });
	  report.systemHealth = await jsonFetch(`${baseUrl}/mcp`, {
	    method: "POST",
	    headers,
	    body: JSON.stringify(mcpRequest("tools/call", {
	      name: "pact.discovery",
	      arguments: {
	        apiVersion: "v0.0.1:mcp:interface-1",
	        operation: "system.health",
        input: {}
      }
    }, 3))
  });
} else {
  report.toolsList = {
    ok: false,
    status: 0,
    skipped: true,
    reason: "Set PACT_MCP_TOKEN or pass --token to verify tools/list."
  };
  report.systemHealth = {
    ok: false,
    status: 0,
    skipped: true,
    reason: "Set PACT_MCP_TOKEN or pass --token to verify tools/call system.health."
  };
}

report.deviceManifest = await readDeviceManifest();
const vmHealthUrl = String(report.discovery.payload?.mcpServers?.pact?.vmHttpUrl || "")
  .replace(/\/mcp$/, "/api/healthz");
report.orbStack = vmHealthUrl
	  ? {
	      kate: await checkOrbStackVm({ vm: "kate", user: "kate", healthUrl: vmHealthUrl }),
	      serena: await checkOrbStackVm({ vm: "serena", user: "serena", healthUrl: vmHealthUrl })
    }
  : {
      kate: { ok: false, skipped: true, reason: "No VM health URL discovered." },
	      serena: { ok: false, skipped: true, reason: "No VM health URL discovered." }
	    };

const expectedOutlets = [
  "pact.discovery",
  "pact.agentLibrary",
  "pact.sharedspace",
  "pact.codespace",
  "pact.skillHub",
  "pact.agentRelay",
  "pact.serviceHub"
];
const listedToolNames = new Set((report.toolsList.payload?.result?.tools || []).map((tool) => tool.name));
const hasSevenOutlets = expectedOutlets.every((name) => listedToolNames.has(name));

const ok = report.signedDiscovery.ok
  && report.discovery.ok
  && report.initialize.ok
  && report.deviceManifest.ok
  && (!token || (
    report.toolsList.ok
    && (report.toolsList.payload?.result?.tools || []).length === expectedOutlets.length
    && hasSevenOutlets
    && report.systemHealth.ok
    && report.systemHealth.payload?.result?.structuredContent?.payload?.ok === true
  ));
console.log(JSON.stringify({
  ok,
  checks: {
    signedDiscovery: {
      ok: report.signedDiscovery.ok,
      baseUrl,
      identityKeyId: report.signedDiscovery.identityKeyId || "",
      attempts: report.signedDiscovery.attempts || []
    },
    discovery: {
      ok: report.discovery.ok,
      status: report.discovery.status,
      httpUrl: report.discovery.payload?.mcpServers?.pact?.httpUrl || "",
      vmHttpUrl: report.discovery.payload?.mcpServers?.pact?.vmHttpUrl || "",
      installerPackage: report.discovery.payload?.installer?.packageName || "",
      githubOneLineCommand: report.discovery.payload?.installer?.githubOneLineCommand || "",
      installerCommand: report.discovery.payload?.installer?.installCommand || "",
      interactiveInstallCommand: report.discovery.payload?.installer?.interactiveInstallCommand || "",
      clientInstallCommand: report.discovery.payload?.installer?.clientInstallCommand || "",
      discoverCommand: report.discovery.payload?.installer?.discoverCommand || "",
      scanCommand: report.discovery.payload?.installer?.scanCommand || "",
      localDiscoveryEntrypoint: report.discovery.payload?.localDiscovery?.entrypoint || null,
      localDiscoveryFiles: report.discovery.payload?.localDiscovery?.files || []
    },
    initialize: {
      ok: report.initialize.ok,
      status: report.initialize.status,
      serverName: report.initialize.payload?.result?.serverInfo?.name || "",
      serverVersion: report.initialize.payload?.result?.serverInfo?.version || "",
      listChanged: report.initialize.payload?.result?.capabilities?.tools?.listChanged === true,
      stableToolName: report.initialize.payload?.result?._meta?.stableToolName || ""
    },
    toolsList: {
      ok: report.toolsList.ok,
	      status: report.toolsList.status,
	      skipped: report.toolsList.skipped === true,
	      toolCount: report.toolsList.payload?.result?.tools?.length || 0,
	      stableOutletSet: hasSevenOutlets,
	      reason: report.toolsList.reason || ""
	    },
    systemHealth: {
      ok: report.systemHealth.ok,
      status: report.systemHealth.status,
      skipped: report.systemHealth.skipped === true,
      healthy: report.systemHealth.payload?.result?.structuredContent?.payload?.ok === true,
      operation: report.systemHealth.payload?.result?.structuredContent?.operation || "",
      reason: report.systemHealth.reason || ""
    },
    deviceManifest: {
      ok: report.deviceManifest.ok,
      exists: report.deviceManifest.exists,
      path: report.deviceManifest.path,
      httpUrl: report.deviceManifest.httpUrl || "",
      vmHttpUrl: report.deviceManifest.vmHttpUrl || "",
      connector: report.deviceManifest.connector || null,
      installedTargets: report.deviceManifest.installedTargets || [],
      targetStatuses: Object.fromEntries(Object.entries(report.deviceManifest.targets || {}).map(([target, value]) => [
        target,
        value?.status || "unknown"
      ])),
      reason: report.deviceManifest.error || ""
    },
    orbStack: {
      kate: report.orbStack.kate,
      serena: report.orbStack.serena
    }
  }
}, null, 2));

process.exit(ok ? 0 : 1);
