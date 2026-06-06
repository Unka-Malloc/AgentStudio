import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createToolCatalogRegistry } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import { createToolManagementStore } from "../platform/specialized/capabilities/tools/tool-management-core/store.mjs";
import { ServerConfig } from "../platform/common/config/ServerConfig.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_BASE_URL = "";
const DEFAULT_TOKEN_ENV = "PACT_MCP_TOKEN";
const DEFAULT_CODEX_BIN = "codex";
const DEFAULT_CLAUDE_BIN = "claude";
const DEFAULT_GEMINI_BIN = "gemini";
const DEFAULT_KILO_BIN = "kilo";
const DEFAULT_COPILOT_BIN = "copilot";
const DEFAULT_OPENCODE_BIN = "opencode";
const DEFAULT_ORB_BIN = "orb";
const PLUGIN_NAME = "pact-mcp";
const MARKETPLACE_NAME = "pact-local";
const GEMINI_EXTENSION_NAME = "Pact";
const MCP_SERVER_NAME = "pact";
const MCP_CONNECTOR_PACKAGE_NAME = "pact-mcp-connector";
const MCP_CONNECTOR_VERSION = "0.0.1";
const HTTP_TIMEOUT_MS = 300000;
const SUPPORTED_TARGETS = [
  "openclaw",
  "claude-code",
  "codex",
  "gemini-cli",
  "antigravity",
  "opencode",
  "copilot",
  "kilo-code",
  "cursor",
  "hermes",
  "windsurf"
];
const TARGET_ALIASES = new Map([
  ["gemini", "gemini-cli"],
  ["gemini_cli", "gemini-cli"],
  ["claude", "claude-code"],
  ["claude_code", "claude-code"],
  ["claudecode", "claude-code"],
  ["kilo", "kilo-code"],
  ["kilocode", "kilo-code"],
  ["kilo_code", "kilo-code"],
  ["github-copilot", "copilot"],
  ["openclaw-kate", "openclaw"],
  ["hermes-agent", "hermes"],
  ["hermes-serena", "hermes"],
  ["cursor-agent", "cursor"],
  ["open-code", "opencode"]
]);

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function repoRoot() {
  return path.resolve(new URL("../..", import.meta.url).pathname);
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function normalizeTarget(value) {
  const raw = String(value || "").trim().toLowerCase();
  return TARGET_ALIASES.get(raw) || raw;
}

function parseTargets() {
  const raw = argValue("--target", "codex");
  const values = raw.split(",").map(normalizeTarget).filter(Boolean);
  const deduped = [...new Set(values)];
  for (const target of deduped) {
    if (!SUPPORTED_TARGETS.includes(target)) {
      throw new Error(`Unsupported install target: ${target}`);
    }
  }
  return deduped;
}

function redactToken(value) {
  const text = String(value || "");
  if (text.length <= 12) {
    return "***";
  }
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function vmBaseUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  return `${parsed.protocol}//host.orb.internal:${port}`;
}

async function run(command, args = [], options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd || repoRoot(),
      env: {
        ...process.env,
        ...(options.env || {})
      },
      maxBuffer: 10 * 1024 * 1024
    });
    return {
      ok: true,
      stdout: result.stdout || "",
      stderr: result.stderr || ""
    };
  } catch (error) {
    if (options.allowFailure) {
      return {
        ok: false,
        stdout: error.stdout || "",
        stderr: error.stderr || error.message || ""
      };
    }
    const message = error.stderr || error.stdout || error.message || "command failed";
    throw new Error(`${command} failed: ${message}`);
  }
}

async function runWithInput(command, args = [], input = "", options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot(),
      env: {
        ...process.env,
        ...(options.env || {})
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (options.allowFailure) {
        resolve({ ok: false, stdout, stderr: stderr || error.message || "" });
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, stdout, stderr });
        return;
      }
      if (options.allowFailure) {
        resolve({ ok: false, stdout, stderr });
        return;
      }
      reject(new Error(`${command} exited with ${code}: ${stderr || stdout}`));
    });
    child.stdin.end(input);
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    payload: text.trim() ? JSON.parse(text) : {}
  };
}

async function ensureService(baseUrl) {
  const initialize = await fetchJson(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "pact-mcp-install", version: "1" }
      }
    })
  });
  if (!initialize.ok || initialize.payload?.result?.serverInfo?.name !== "Pact") {
    throw new Error(`Pact MCP is not available at ${baseUrl}/mcp.`);
  }
  return initialize;
}

function defaultGrantInput(target) {
  return {
    label: `Pact MCP ${target}`,
    type: "machine",
    scopes: ["storage:read", "jobs:read", "knowledge:read", "knowledge:write"],
    toolsets: [
      "pact.runtime.read",
      "pact.storage.read",
      "pact.jobs.read",
      "pact.knowledge.read",
      "pact.knowledge.write",
      "pact.agent.workspace",
      "pact.document.parse",
      "pact.result.export"
    ],
    metadata: {
      mcpServer: MCP_SERVER_NAME,
      mcpTarget: target,
      operatorId: `${target}:local`,
      subjectId: "local.user",
      agentProfileId: `pact.mcp.${target}`,
      transport: "http",
      maxRisk: "safe_write"
    },
    rateLimit: { perMinute: 0 },
    reason: "Created by npm run server:mcp:install."
  };
}

async function createOrRotateGrant({ dataDir, target }) {
  const registry = createToolCatalogRegistry({ operations: SERVER_API_OPERATIONS });
  const store = createToolManagementStore({ userDataPath: dataDir, registry });
  try {
    const existing = store.listGrants({ includeRevoked: false }).find((grant) =>
      grant.metadata?.mcpServer === MCP_SERVER_NAME && grant.metadata?.mcpTarget === target
    );
    const result = existing
      ? await store.rotateGrantToken(existing.id)
      : await store.createGrant(defaultGrantInput(target));
    if (!result?.token) {
      throw new Error(`Failed to create or rotate MCP grant for ${target}.`);
    }
    return result;
  } finally {
    store.close();
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(`${filePath}.tmp`, filePath);
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}.tmp`, value, { mode: 0o600 });
  await fs.rename(`${filePath}.tmp`, filePath);
}

async function readJson(filePath, fallback = {}) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function backupIfExists(filePath) {
  try {
    await fs.access(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
  const backupPath = `${filePath}.bak-pact-mcp-${timestamp()}`;
  await fs.copyFile(filePath, backupPath);
  return backupPath;
}

async function verifyMcpTools({ baseUrl, token }) {
  const toolsList = await fetchJson(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
  });
  const health = await fetchJson(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "pact.call",
        arguments: {
          apiVersion: "pact.mcp.v1",
          operation: "system.health",
          input: {}
        }
      }
    })
  });
  const tools = toolsList.payload?.result?.tools || [];
  if (
    !toolsList.ok
    || !health.ok
    || (tools.length !== 1 && tools.length !== 5)
    || !tools.some((tool) => tool.name === "pact.call" || tool.name === "pact.discovery" || tool.name === "pact.sharedspace")
    || health.payload?.result?.structuredContent?.payload?.ok !== true
  ) {
    throw new Error("MCP HTTP verification failed.");
  }
  return {
    toolCount: tools.length,
    stableToolName: tools.find((tool) => tool.name === "pact.call")?.name || "pact.call",
    systemHealthOk: health.payload?.result?.structuredContent?.payload?.ok === true
  };
}

async function createCodexPlugin({ marketplaceRoot, baseUrl, tokenEnv }) {
  const pluginRoot = path.join(marketplaceRoot, "plugins", PLUGIN_NAME);
  await fs.mkdir(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
  await writeJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"), {
    name: PLUGIN_NAME,
    version: "0.0.1",
    description: "Pact local MCP integration for Codex.",
    author: {
      name: "Unka Y.Y.",
      url: "https://github.com/Unka-Malloc"
    },
    homepage: "https://github.com/Unka-Malloc/Pact",
    repository: "https://github.com/Unka-Malloc/Pact",
    license: "GPL-3.0-or-later",
    keywords: ["pact", "mcp", "workspace", "knowledge"],
    mcpServers: "./.mcp.json",
    interface: {
      displayName: "Pact MCP",
      shortDescription: "Connect Codex to the local Pact MCP service",
      longDescription: "Use the local Pact HTTP MCP endpoint to inspect runtime health, browse registered tools, and call authorized Pact workspace and knowledge tools through Tool Management grants.",
      developerName: "Unka-Malloc",
      category: "Coding",
      capabilities: ["Interactive", "Read", "Write"],
      websiteURL: "https://github.com/Unka-Malloc/Pact",
      privacyPolicyURL: "https://github.com/Unka-Malloc/Pact",
      termsOfServiceURL: "https://github.com/Unka-Malloc/Pact",
      defaultPrompt: [
        "Use Pact MCP to inspect local workspace and knowledge tools"
      ],
      brandColor: "#2563EB",
      screenshots: []
    }
  });
  await writeJson(path.join(pluginRoot, ".mcp.json"), {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: "http",
        url: `${baseUrl}/mcp`,
        bearer_token_env_var: tokenEnv,
        note: "Local Pact HTTP MCP service. Token is provided through PACT_MCP_TOKEN by the installer."
      }
    }
  });
  await writeJson(path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json"), {
    name: MARKETPLACE_NAME,
    interface: {
      displayName: "Pact Local"
    },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: {
          source: "local",
          path: `./plugins/${PLUGIN_NAME}`
        },
        policy: {
          installation: "AVAILABLE",
          authentication: "ON_INSTALL"
        },
        category: "Coding"
      }
    ]
  });
  return {
    pluginRoot,
    marketplacePath: path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json")
  };
}

async function installCodex({ baseUrl, token, tokenEnv, codexBin, marketplaceRoot }) {
  await run("launchctl", ["setenv", tokenEnv, token], { allowFailure: true });
  process.env[tokenEnv] = token;
  const plugin = await createCodexPlugin({ marketplaceRoot, baseUrl, tokenEnv });
  await run(codexBin, ["plugin", "marketplace", "add", marketplaceRoot], { allowFailure: true });
  await run(codexBin, ["plugin", "remove", `${PLUGIN_NAME}@${MARKETPLACE_NAME}`], { allowFailure: true });
  await run(codexBin, ["plugin", "add", `${PLUGIN_NAME}@${MARKETPLACE_NAME}`]);
  await run(codexBin, ["mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  await run(codexBin, [
    "mcp",
    "add",
    MCP_SERVER_NAME,
    "--url",
    `${baseUrl}/mcp`,
    "--bearer-token-env-var",
    tokenEnv
  ]);
  const mcpGet = await run(codexBin, ["mcp", "get", MCP_SERVER_NAME], {
    env: { [tokenEnv]: token }
  });
  return {
    installMode: "codex-plugin-and-mcp-cli",
    plugin: `${PLUGIN_NAME}@${MARKETPLACE_NAME}`,
    pluginRoot: plugin.pluginRoot,
    marketplacePath: plugin.marketplacePath,
    mcpGet: mcpGet.stdout
  };
}

async function installClaudeCode({ baseUrl, token, claudeBin }) {
  const serverJson = JSON.stringify({
    type: "http",
    url: `${baseUrl}/mcp`,
    headers: {
      "X-Pact-Api-Key": token
    }
  });
  await run(claudeBin, ["mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  await run(claudeBin, ["mcp", "add-json", "--scope", "user", MCP_SERVER_NAME, serverJson]);
  const get = await run(claudeBin, ["mcp", "get", MCP_SERVER_NAME]);
  return {
    installMode: "claude-code-mcp-cli",
    mcpGetHasPact: get.stdout.includes(MCP_SERVER_NAME) || get.stdout.includes(`${baseUrl}/mcp`)
  };
}

async function createGeminiExtension({ extensionRoot, baseUrl, token }) {
  await writeJson(path.join(extensionRoot, "gemini-extension.json"), {
    name: GEMINI_EXTENSION_NAME,
    version: "0.0.1",
    description: "Connect Gemini CLI to the local Pact MCP service.",
    mcpServers: {
      [MCP_SERVER_NAME]: {
        httpUrl: `${baseUrl}/mcp`,
        headers: {
          "X-Pact-Api-Key": token
        },
        timeout: HTTP_TIMEOUT_MS
      }
    }
  });
  await writeText(
    path.join(extensionRoot, "README.md"),
    "# Pact MCP\n\nLocal Gemini CLI extension generated by `npm run server:mcp:install`.\n"
  );
}

async function installGemini({ baseUrl, token, geminiBin, extensionRoot }) {
  await createGeminiExtension({ extensionRoot, baseUrl, token });
  await run(geminiBin, ["extensions", "validate", extensionRoot]);
  await run(geminiBin, ["mcp", "remove", "--scope", "user", MCP_SERVER_NAME], { allowFailure: true });
  await run(geminiBin, [
    "mcp",
    "add",
    "--scope",
    "user",
    "--transport",
    "http",
    "--header",
    `X-Pact-Api-Key: ${token}`,
    "--timeout",
    String(HTTP_TIMEOUT_MS),
    "--trust",
    "--description",
    "Local Pact HTTP MCP service.",
    MCP_SERVER_NAME,
    `${baseUrl}/mcp`
  ]);
  const list = await run(geminiBin, ["mcp", "list"]);
  const listOutput = `${list.stdout}\n${list.stderr}`;
  if (!listOutput.includes(MCP_SERVER_NAME)) {
    throw new Error("Gemini CLI MCP list does not include pact after install.");
  }
  return {
    installMode: "gemini-mcp-cli",
    extensionRoot,
    mcpListHasPact: true
  };
}

async function installKilo({ baseUrl, token, kiloBin, kiloConfigPath }) {
  const config = await readJson(kiloConfigPath, {});
  const backupPath = await backupIfExists(kiloConfigPath);
  config.mcp = {
    ...(config.mcp || {}),
    [MCP_SERVER_NAME]: {
      type: "remote",
      url: `${baseUrl}/mcp`,
      enabled: true,
      headers: {
        "X-Pact-Api-Key": token
      },
      timeout: HTTP_TIMEOUT_MS
    }
  };
  await writeJson(kiloConfigPath, config);
  const list = await run(kiloBin, ["mcp", "list"], { allowFailure: true });
  return {
    installMode: "kilo-global-kilo-json",
    configPath: kiloConfigPath,
    backupPath,
    mcpListHasPact: list.stdout.includes(MCP_SERVER_NAME) || list.stderr.includes(MCP_SERVER_NAME)
  };
}

async function installCopilot({ baseUrl, token, copilotBin }) {
  await run(copilotBin, ["mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  await run(copilotBin, [
    "mcp",
    "add",
    "--transport",
    "http",
    "--header",
    `X-Pact-Api-Key: ${token}`,
    "--timeout",
    String(HTTP_TIMEOUT_MS),
    MCP_SERVER_NAME,
    `${baseUrl}/mcp`
  ]);
  const get = await run(copilotBin, ["mcp", "get", MCP_SERVER_NAME]);
  return {
    installMode: "copilot-mcp-cli",
    mcpGetHasPact: get.stdout.includes(MCP_SERVER_NAME) || get.stdout.includes(`${baseUrl}/mcp`)
  };
}

async function installAntigravity({ baseUrl, token, configPath }) {
  return installMcpServersJsonConfig({
    baseUrl,
    token,
    configPath,
    installMode: "antigravity-mcp-config",
    urlKey: "serverUrl"
  });
}

async function installMcpServersJsonConfig({ baseUrl, token, configPath, installMode, urlKey = "url" }) {
  const config = await readJson(configPath, { mcpServers: {} });
  const backupPath = await backupIfExists(configPath);
  config.mcpServers = {
    ...(config.mcpServers || {}),
    [MCP_SERVER_NAME]: {
      [urlKey]: `${baseUrl}/mcp`,
      headers: {
        "X-Pact-Api-Key": token
      },
      disabled: false
    }
  };
  await writeJson(configPath, config);
  return {
    installMode,
    configPath,
    backupPath
  };
}

async function installOpenCode({ baseUrl, token, configPath }) {
  const config = await readJson(configPath, {});
  const backupPath = await backupIfExists(configPath);
  config.mcp = {
    ...(config.mcp || {}),
    [MCP_SERVER_NAME]: {
      type: "remote",
      url: `${baseUrl}/mcp`,
      headers: {
        "X-Pact-Api-Key": token
      },
      enabled: true
    }
  };
  await writeJson(configPath, config);
  return {
    installMode: "opencode-mcp-config",
    configPath,
    backupPath
  };
}

async function installOpenClaw({ baseUrl, token, orbBin, vmName, vmUser, openclawBin }) {
  if (!vmName || !vmUser || !openclawBin) {
    throw new Error("OpenClaw install requires --openclaw-vm, --openclaw-user, and --openclaw-bin. No default OpenClaw path is assumed.");
  }
  const url = `${vmBaseUrl(baseUrl)}/mcp`;
  const config = {
    type: "http",
    url,
    headers: {
      "X-Pact-Api-Key": token
    },
    timeout: HTTP_TIMEOUT_MS,
    enabled: true
  };
  await run(orbBin, ["-m", vmName, "-u", vmUser, openclawBin, "mcp", "set", MCP_SERVER_NAME, JSON.stringify(config)]);
  const show = await run(orbBin, ["-m", vmName, "-u", vmUser, openclawBin, "mcp", "show", MCP_SERVER_NAME]);
  return {
    installMode: "openclaw-mcp-cli",
    vm: vmName,
    vmUser,
    url,
    mcpShowHasPact: show.stdout.includes(MCP_SERVER_NAME) || show.stdout.includes(url)
  };
}

async function installHermes({ baseUrl, token, orbBin, vmName, vmUser, hermesBin }) {
  if (!vmName || !vmUser || !hermesBin) {
    throw new Error("Hermes install requires --hermes-vm, --hermes-user, and --hermes-bin. No default Hermes path is assumed.");
  }
  const url = `${vmBaseUrl(baseUrl)}/mcp`;
  const script = [
    "set -e",
    "IFS= read -r token",
    "export MCP_PACT_API_KEY=\"$token\"",
    "if [ -d \"$HOME/.hermes/hermes-agent\" ]; then",
    "  cd \"$HOME/.hermes/hermes-agent\"",
    "  if [ -f venv/bin/activate ]; then . venv/bin/activate; fi",
    "  python - <<'PY'",
    "import os",
    "from hermes_cli.config import save_env_value",
    "save_env_value('MCP_PACT_API_KEY', os.environ['MCP_PACT_API_KEY'])",
    "PY",
    "fi",
    "printf 'y\\n' | \"$HERMES_BIN\" mcp remove pact >/dev/null 2>&1 || true",
    "printf 'y\\ny\\n' | \"$HERMES_BIN\" mcp add pact --url \"$PACT_URL\" --auth header"
  ].join("\n");
  await runWithInput(orbBin, [
    "-m",
    vmName,
    "-u",
    vmUser,
    "env",
    `HERMES_BIN=${hermesBin}`,
    `PACT_URL=${url}`,
    "bash",
    "-lc",
    script
  ], `${token}\n`);
  const enableScript = [
    "set -e",
    "if [ -d \"$HOME/.hermes/hermes-agent\" ]; then",
    "  cd \"$HOME/.hermes/hermes-agent\"",
    "  if [ -f venv/bin/activate ]; then . venv/bin/activate; fi",
    "  python - <<'PY'",
    "from hermes_cli.config import load_config, save_config",
    "cfg = load_config()",
    "server = cfg.setdefault('mcp_servers', {}).setdefault('pact', {})",
    "server['enabled'] = True",
    "save_config(cfg)",
    "PY",
    "fi"
  ].join("\n");
  await run(orbBin, ["-m", vmName, "-u", vmUser, "bash", "-lc", enableScript]);
  await run(orbBin, ["-m", vmName, "-u", vmUser, hermesBin, "mcp", "test", MCP_SERVER_NAME]);
  const list = await run(orbBin, ["-m", vmName, "-u", vmUser, hermesBin, "mcp", "list"]);
  const listOutput = `${list.stdout}\n${list.stderr}`;
  return {
    installMode: "hermes-mcp-cli",
    vm: vmName,
    vmUser,
    url,
    mcpListHasPact: listOutput.includes(MCP_SERVER_NAME),
    mcpListEnabled: listOutput.includes("enabled")
  };
}

async function writeDeviceDiscovery({ baseUrl, marketplaceRoot, codexPluginRoot, installed }) {
  const parsed = new URL(baseUrl);
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  const manifestPath = path.join(os.homedir(), ".pact", "mcp", "servers.json");
  const existingManifest = await readJson(manifestPath, {});
  const existingServer = existingManifest?.servers?.[MCP_SERVER_NAME] || {};
  const existingTargets = existingServer.targets || {};
  const targetStatuses = Object.fromEntries(SUPPORTED_TARGETS.map((target) => [
    target,
    installed[target]
      ? {
          installMode: installed[target].installMode,
          status: "installed",
          grantId: installed[target].grantId,
          tokenPrefix: installed[target].tokenPrefix
        }
      : existingTargets[target] || {
          installMode: "supported",
          status: "not-installed"
        }
  ]));
  await writeJson(manifestPath, {
    version: 1,
    generatedAt: new Date().toISOString(),
    servers: {
      [MCP_SERVER_NAME]: {
        name: "Pact",
        httpUrl: `${baseUrl}/mcp`,
        vmHttpUrl: `${parsed.protocol}//host.orb.internal:${port}/mcp`,
        auth: {
          type: "per-target-token",
          acceptedHeaders: ["Authorization: Bearer <token>", "X-Pact-Api-Key"]
        },
        connector: {
          packageName: MCP_CONNECTOR_PACKAGE_NAME,
          packageVersion: MCP_CONNECTOR_VERSION,
          registerCommand: `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest register`,
          installCommand: `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest install --target <client>`,
          discoverCommand: `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest discover-local`,
          doctorCommand: `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest doctor`
        },
        codex: codexPluginRoot
          ? {
              plugin: `${PLUGIN_NAME}@${MARKETPLACE_NAME}`,
              marketplaceRoot,
              pluginRoot: codexPluginRoot,
              tokenEnv: DEFAULT_TOKEN_ENV,
              installCommand: `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest install --target codex`
            }
          : existingServer.codex || null,
        targets: targetStatuses
      }
    }
  });
}

const targets = parseTargets();
const baseUrl = normalizeBaseUrl(argValue("--url", process.env.PACT_MCP_BASE_URL || DEFAULT_BASE_URL));
if (!baseUrl) {
  throw new Error("server:mcp:install requires --url or PACT_MCP_BASE_URL. End-user installs should use pact-mcp install, which discovers and verifies the server.");
}
const dataDir = path.resolve(argValue("--data-dir", ServerConfig.getDataDir()));
const codexBin = argValue("--codex-bin", process.env.CODEX_CLI_PATH || DEFAULT_CODEX_BIN);
const claudeBin = argValue("--claude-bin", process.env.CLAUDE_CODE_CLI_PATH || DEFAULT_CLAUDE_BIN);
const geminiBin = argValue("--gemini-bin", process.env.GEMINI_CLI_PATH || DEFAULT_GEMINI_BIN);
const kiloBin = argValue("--kilo-bin", process.env.KILO_CLI_PATH || DEFAULT_KILO_BIN);
const copilotBin = argValue("--copilot-bin", process.env.COPILOT_CLI_PATH || DEFAULT_COPILOT_BIN);
const opencodeBin = argValue("--opencode-bin", process.env.OPENCODE_CLI_PATH || DEFAULT_OPENCODE_BIN);
const orbBin = argValue("--orb-bin", process.env.ORB_CLI_PATH || DEFAULT_ORB_BIN);
const tokenEnv = argValue("--token-env", DEFAULT_TOKEN_ENV);
const marketplaceRoot = path.resolve(argValue(
  "--marketplace-root",
  path.join(os.homedir(), ".pact", "codex-plugin-marketplace")
));
const geminiExtensionRoot = path.resolve(argValue(
  "--gemini-extension-root",
  path.join(os.homedir(), ".pact", "gemini-extensions", PLUGIN_NAME)
));
const kiloConfigPath = path.resolve(argValue(
  "--kilo-config",
  path.join(os.homedir(), ".config", "kilo", "kilo.json")
));
const antigravityConfigPath = path.resolve(argValue(
  "--antigravity-config",
  path.join(os.homedir(), ".gemini", "antigravity", "mcp_config.json")
));
const opencodeConfigPath = path.resolve(argValue(
  "--opencode-config",
  path.join(os.homedir(), ".config", "opencode", "opencode.jsonc")
));
const cursorConfigPath = path.resolve(argValue(
  "--cursor-config",
  path.join(os.homedir(), "Library", "Application Support", "Cursor", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json")
));
const windsurfConfigPath = path.resolve(argValue(
  "--windsurf-config",
  path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json")
));
const sharedVmName = argValue("--vm", "");
const sharedVmUser = argValue("--vm-user", "");
const openclawVm = argValue("--openclaw-vm", sharedVmName);
const openclawVmUser = argValue("--openclaw-user", sharedVmUser);
const openclawBin = argValue("--openclaw-bin", "");
const hermesVm = argValue("--hermes-vm", sharedVmName);
const hermesVmUser = argValue("--hermes-user", sharedVmUser);
const hermesBin = argValue("--hermes-bin", "");
const verify = !hasFlag("--no-verify");

await ensureService(baseUrl);

const installed = {};
for (const target of targets) {
  const grantResult = await createOrRotateGrant({ dataDir, target });
  let clientResult = null;
  if (target === "codex") {
    clientResult = await installCodex({ baseUrl, token: grantResult.token, tokenEnv, codexBin, marketplaceRoot });
  } else if (target === "claude-code") {
    clientResult = await installClaudeCode({ baseUrl, token: grantResult.token, claudeBin });
  } else if (target === "gemini-cli") {
    clientResult = await installGemini({ baseUrl, token: grantResult.token, geminiBin, extensionRoot: geminiExtensionRoot });
  } else if (target === "kilo-code") {
    clientResult = await installKilo({ baseUrl, token: grantResult.token, kiloBin, kiloConfigPath });
  } else if (target === "copilot") {
    clientResult = await installCopilot({ baseUrl, token: grantResult.token, copilotBin });
  } else if (target === "openclaw") {
    clientResult = await installOpenClaw({
      baseUrl,
      token: grantResult.token,
      orbBin,
      vmName: openclawVm,
      vmUser: openclawVmUser,
      openclawBin
    });
  } else if (target === "hermes") {
    clientResult = await installHermes({
      baseUrl,
      token: grantResult.token,
      orbBin,
      vmName: hermesVm,
      vmUser: hermesVmUser,
      hermesBin
    });
  } else if (target === "antigravity") {
    clientResult = await installAntigravity({ baseUrl, token: grantResult.token, configPath: antigravityConfigPath });
  } else if (target === "opencode") {
    clientResult = await installOpenCode({ baseUrl, token: grantResult.token, configPath: opencodeConfigPath });
  } else if (target === "cursor") {
    clientResult = await installMcpServersJsonConfig({
      baseUrl,
      token: grantResult.token,
      configPath: cursorConfigPath,
      installMode: "cursor-mcp-config"
    });
  } else if (target === "windsurf") {
    clientResult = await installMcpServersJsonConfig({
      baseUrl,
      token: grantResult.token,
      configPath: windsurfConfigPath,
      installMode: "windsurf-mcp-config"
    });
  }
  const httpVerification = verify
    ? await verifyMcpTools({ baseUrl, token: grantResult.token })
    : null;
  installed[target] = {
    ...(clientResult || {}),
    grantId: grantResult.grant.id,
    tokenPrefix: grantResult.grant.tokenPrefix,
    httpVerification
  };
}

await writeDeviceDiscovery({
  baseUrl,
  marketplaceRoot,
  codexPluginRoot: installed.codex?.pluginRoot || "",
  installed
});

console.log(JSON.stringify({
  ok: true,
  targets,
  baseUrl,
  discoveryManifest: path.join(os.homedir(), ".pact", "mcp", "servers.json"),
  installed: Object.fromEntries(Object.entries(installed).map(([target, value]) => [
    target,
    {
      ...value,
      mcpGet: undefined
    }
  ]))
}, null, 2));
