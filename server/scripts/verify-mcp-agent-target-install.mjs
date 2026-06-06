import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const connectorScript = path.join(repoRoot, "mcp-connector", "bin", "pact-mcp.mjs");
const DECLARED_AGENT_TARGETS = Object.freeze([
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
]);
const PRIORITY_AGENT_TARGETS = Object.freeze(["codex", "claude-code", "openclaw"]);
const EXPECTED_AGENT_PROFILES = Object.freeze(Object.fromEntries(
  DECLARED_AGENT_TARGETS.map((target) => [target, `pact.mcp.${target}`])
));
const RELEASE_BOOTSTRAP = `/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)"`;
const RELEASE_BOOTSTRAP_ZH_CN = `/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.zh-CN.sh)"`;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { timeout: options.timeoutMs || 5000, ...options });
  const text = await response.text();
  return { status: response.status, ok: response.ok, payload: text.trim() ? JSON.parse(text) : {} };
}

let passed = 0;
let failed = 0;

function check(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    fn();
    passed++;
    console.log("ok");
  } catch (error) {
    failed++;
    console.log(`FAIL\n      ${error.message}`);
  }
}

async function testAsync(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    passed++;
    console.log("ok");
  } catch (error) {
    failed++;
    console.log(`FAIL\n      ${error.message}`);
  }
}

function spawnConnector(args, timeoutMs = 30000, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [connectorScript, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), signal: signal || "", stdout, stderr }));
    child.on("error", (err) => resolve({ code: 1, stdout: "", stderr: err.message }));
  });
}

function runProcess(command, args = [], timeoutMs = 10000, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), signal: signal || "", stdout, stderr }));
    child.on("error", (err) => resolve({ code: 1, signal: "", stdout: "", stderr: err.message }));
  });
}

function unsetLaunchctlEnv(name) {
  if (process.platform !== "darwin") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const child = spawn("launchctl", ["unsetenv", name], { stdio: "ignore" });
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-target-install-"));
const opencodeConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-target-config-"));
const opencodeConfigPath = path.join(opencodeConfigDir, "opencode.jsonc");
const autoOpencodeConfigPath = path.join(opencodeConfigDir, "opencode-auto.jsonc");
const tempRegistryPath = path.join(opencodeConfigDir, "pact-servers.json");
const autoRegistryPath = path.join(opencodeConfigDir, "pact-auto-servers.json");
const autoMarketplaceRoot = path.join(opencodeConfigDir, "codex-marketplace");
const autoKiloConfigPath = path.join(opencodeConfigDir, "kilo", "kilo.json");
const hangKiloConfigPath = path.join(opencodeConfigDir, "kilo-hang", "kilo.json");
const autoAntigravityConfigPath = path.join(opencodeConfigDir, "antigravity", "mcp_config.json");
const noDetectHome = path.join(opencodeConfigDir, "no-detect-home");
const noDetectRegistryPath = path.join(opencodeConfigDir, "pact-no-detect-servers.json");
const registerRegistryPath = path.join(opencodeConfigDir, "pact-register-servers.json");
const remoteOpenCodeHome = path.join(opencodeConfigDir, "remote-opencode-home");
const remoteOpenCodeRegistryPath = path.join(opencodeConfigDir, "pact-remote-opencode-servers.json");
const remoteCodexRegistryPath = path.join(opencodeConfigDir, "pact-remote-codex-servers.json");
const autoTokenEnv = `PACT_VERIFY_AUTO_MCP_TOKEN_${randomBytes(4).toString("hex").toUpperCase()}`;
const missingDoctorTokenEnv = `PACT_VERIFY_DOCTOR_TOKEN_${randomBytes(4).toString("hex").toUpperCase()}`;
const missingInstallTokenEnv = `PACT_VERIFY_INSTALL_TOKEN_${randomBytes(4).toString("hex").toUpperCase()}`;
const remoteCodexTokenEnv = `PACT_VERIFY_REMOTE_CODEX_TOKEN_${randomBytes(4).toString("hex").toUpperCase()}`;
const fixtureAgentCommandLog = path.join(opencodeConfigDir, "fixture-agent-commands.log");
const fixtureBinDir = path.join(opencodeConfigDir, "bin");
const fixtureCodexPath = path.join(fixtureBinDir, process.platform === "win32" ? "codex.cmd" : "codex");
const fixtureClaudePath = path.join(fixtureBinDir, process.platform === "win32" ? "claude.cmd" : "claude");
const fixtureClaudeHangPath = path.join(fixtureBinDir, process.platform === "win32" ? "claude-hang.cmd" : "claude-hang");
const fixtureGeminiPath = path.join(fixtureBinDir, process.platform === "win32" ? "gemini.cmd" : "gemini");
const fixtureGeminiHangPath = path.join(fixtureBinDir, process.platform === "win32" ? "gemini-hang.cmd" : "gemini-hang");
const fixtureGeminiFailPath = path.join(fixtureBinDir, process.platform === "win32" ? "gemini-fail.cmd" : "gemini-fail");
const fixtureKiloPath = path.join(fixtureBinDir, process.platform === "win32" ? "kilo.cmd" : "kilo");
const fixtureKiloHangPath = path.join(fixtureBinDir, process.platform === "win32" ? "kilo-hang.cmd" : "kilo-hang");
const fixtureCopilotPath = path.join(fixtureBinDir, process.platform === "win32" ? "copilot.cmd" : "copilot");
const fixtureCopilotHangPath = path.join(fixtureBinDir, process.platform === "win32" ? "copilot-hang.cmd" : "copilot-hang");
const fixtureOpenClawPath = path.join(fixtureBinDir, process.platform === "win32" ? "openclaw.cmd" : "openclaw");
const fixtureOpenClawHangPath = path.join(fixtureBinDir, process.platform === "win32" ? "openclaw-hang.cmd" : "openclaw-hang");
const fixtureOpencodePath = path.join(fixtureBinDir, process.platform === "win32" ? "opencode.cmd" : "opencode");
const fixtureDockerPath = path.join(fixtureBinDir, process.platform === "win32" ? "docker.cmd" : "docker");
const unavailableToolBinDir = path.join(opencodeConfigDir, "unavailable-tools");
const unavailableToolPaths = Object.freeze({
  orb: path.join(unavailableToolBinDir, process.platform === "win32" ? "orb.cmd" : "orb"),
  podman: path.join(unavailableToolBinDir, process.platform === "win32" ? "podman.cmd" : "podman"),
  nerdctl: path.join(unavailableToolBinDir, process.platform === "win32" ? "nerdctl.cmd" : "nerdctl"),
  wsl: path.join(unavailableToolBinDir, process.platform === "win32" ? "wsl.cmd" : "wsl"),
  lima: path.join(unavailableToolBinDir, process.platform === "win32" ? "limactl.cmd" : "limactl"),
  colima: path.join(unavailableToolBinDir, process.platform === "win32" ? "colima.cmd" : "colima"),
  multipass: path.join(unavailableToolBinDir, process.platform === "win32" ? "multipass.cmd" : "multipass"),
  lxc: path.join(unavailableToolBinDir, process.platform === "win32" ? "lxc.cmd" : "lxc"),
  incus: path.join(unavailableToolBinDir, process.platform === "win32" ? "incus.cmd" : "incus"),
  vagrant: path.join(unavailableToolBinDir, process.platform === "win32" ? "vagrant.cmd" : "vagrant"),
  parallels: path.join(unavailableToolBinDir, process.platform === "win32" ? "prlctl.cmd" : "prlctl")
});

async function installUnavailableToolBinaries() {
  await fs.mkdir(unavailableToolBinDir, { recursive: true });
  const content = process.platform === "win32"
    ? "@echo off\r\nexit /b 127\r\n"
    : "#!/bin/sh\nexit 127\n";
  for (const filePath of Object.values(unavailableToolPaths)) {
    await fs.writeFile(filePath, content, "utf8");
    if (process.platform !== "win32") {
      await fs.chmod(filePath, 0o755);
    }
  }
}

async function installFixtureAgentCli(filePath) {
  await fs.mkdir(fixtureBinDir, { recursive: true });
  if (process.platform === "win32") {
    await fs.writeFile(filePath, [
      "@echo off",
      "set command_name=%~n0",
      "if \"%PACT_FIXTURE_AGENT_HANG_MCP%\"==\"%command_name%\" if \"%1\"==\"mcp\" (",
      "  ping -n 3600 127.0.0.1 >nul",
      "  exit /b 124",
      ")",
      "if not \"%PACT_FIXTURE_AGENT_FAIL_WITH_ARGS%\"==\"\" if \"%1\"==\"mcp\" (",
      "  echo fixture failure args: %* 1>&2",
      "  exit /b 42",
      ")",
      "if not \"%PACT_FIXTURE_AGENT_LOG%\"==\"\" (",
      "  if \"%1\"==\"mcp\" if \"%2\"==\"add-json\" echo %~n0^|mcp add-json^|%3^|%4^|%5>>\"%PACT_FIXTURE_AGENT_LOG%\"",
      "  if \"%1\"==\"mcp\" if \"%2\"==\"set\" echo %~n0^|mcp set^|%3>>\"%PACT_FIXTURE_AGENT_LOG%\"",
      "  if \"%1\"==\"mcp\" if \"%2\"==\"show\" echo %~n0^|mcp show^|%3>>\"%PACT_FIXTURE_AGENT_LOG%\"",
      "  if \"%1\"==\"mcp\" if \"%2\"==\"add\" if \"%~n0\"==\"codex\" echo %~n0^|mcp add^|%3^|%4^|%5^|%6^|%7>>\"%PACT_FIXTURE_AGENT_LOG%\"",
      ")",
      "if \"%1\"==\"mcp\" if \"%2\"==\"--help\" (",
      "  echo Usage: fixture-agent mcp add add-json get list remove set show",
      "  exit /b 0",
      ")",
      "if \"%1\"==\"plugin\" (",
      "  exit /b 0",
      ")",
      "if \"%1\"==\"extensions\" (",
      "  exit /b 0",
      ")",
      "if \"%1\"==\"mcp\" if \"%2\"==\"remove\" exit /b 0",
      "if \"%1\"==\"mcp\" if \"%2\"==\"add\" exit /b 0",
      "if \"%1\"==\"mcp\" if \"%2\"==\"add-json\" exit /b 0",
      "if \"%1\"==\"mcp\" if \"%2\"==\"set\" exit /b 0",
      "if \"%1\"==\"mcp\" if \"%2\"==\"get\" (",
      "  echo pact http://127.0.0.1/mcp",
      "  exit /b 0",
      ")",
      "if \"%1\"==\"mcp\" if \"%2\"==\"show\" (",
      "  echo pact http://127.0.0.1/mcp",
      "  exit /b 0",
      ")",
      "if \"%1\"==\"mcp\" if \"%2\"==\"list\" echo pact",
      "exit /b 0",
      ""
    ].join("\r\n"));
    return;
  }
  await fs.writeFile(filePath, [
    "#!/bin/sh",
    "command_name=$(basename \"$0\")",
    "if [ \"${PACT_FIXTURE_AGENT_HANG_MCP:-}\" = \"$command_name\" ] && [ \"$1\" = \"mcp\" ]; then",
    "  while :; do sleep 1; done",
    "fi",
    "if [ -n \"${PACT_FIXTURE_AGENT_FAIL_WITH_ARGS:-}\" ] && [ \"$1\" = \"mcp\" ]; then",
    "  printf 'fixture failure args:' >&2",
    "  for arg in \"$@\"; do printf ' <%s>' \"$arg\" >&2; done",
    "  printf '\\n' >&2",
    "  exit 42",
    "fi",
    "if [ -n \"$PACT_FIXTURE_AGENT_LOG\" ]; then",
    "  if [ \"$1\" = \"mcp\" ] && [ \"$2\" = \"add-json\" ]; then",
    "    printf '%s|mcp add-json|%s|%s|%s\\n' \"$command_name\" \"$3\" \"$4\" \"$5\" >> \"$PACT_FIXTURE_AGENT_LOG\"",
    "  elif [ \"$1\" = \"mcp\" ] && [ \"$2\" = \"set\" ]; then",
    "    printf '%s|mcp set|%s\\n' \"$command_name\" \"$3\" >> \"$PACT_FIXTURE_AGENT_LOG\"",
    "  elif [ \"$1\" = \"mcp\" ] && [ \"$2\" = \"show\" ]; then",
    "    printf '%s|mcp show|%s\\n' \"$command_name\" \"$3\" >> \"$PACT_FIXTURE_AGENT_LOG\"",
    "  elif [ \"$command_name\" = \"codex\" ] && [ \"$1\" = \"mcp\" ] && [ \"$2\" = \"add\" ]; then",
    "    printf '%s|mcp add|%s|%s|%s|%s|%s\\n' \"$command_name\" \"$3\" \"$4\" \"$5\" \"$6\" \"$7\" >> \"$PACT_FIXTURE_AGENT_LOG\"",
    "  fi",
    "fi",
    "if [ \"$1\" = \"mcp\" ] && [ \"$2\" = \"--help\" ]; then",
    "  echo 'Usage: fixture-agent mcp add add-json get list remove set show'",
    "  exit 0",
    "fi",
    "if [ \"$1\" = \"plugin\" ]; then exit 0; fi",
    "if [ \"$1\" = \"extensions\" ]; then exit 0; fi",
    "if [ \"$1\" = \"mcp\" ]; then",
    "  case \"$2\" in",
    "    remove|add|add-json|set) exit 0 ;;",
    "    get|show) printf 'pact http://127.0.0.1/mcp\\n'; exit 0 ;;",
    "    list) printf 'pact\\n'; exit 0 ;;",
    "  esac",
    "fi",
    "exit 0",
    ""
  ].join("\n"));
  await fs.chmod(filePath, 0o755);
}

async function installFixturePriorityAgentClis() {
  for (const filePath of [
    fixtureCodexPath,
    fixtureClaudePath,
    fixtureGeminiPath,
    fixtureKiloPath,
    fixtureCopilotPath,
    fixtureOpenClawPath,
    fixtureOpencodePath
  ]) {
    await installFixtureAgentCli(filePath);
  }
}

async function installFixtureDockerRuntime() {
  if (process.platform === "win32") {
    return false;
  }
  await fs.mkdir(fixtureBinDir, { recursive: true });
  await installUnavailableToolBinaries();
  await fs.mkdir(remoteOpenCodeHome, { recursive: true });
  const fixtureDockerScriptPath = `${fixtureDockerPath}.sh`;
  const fixtureDockerSourcePath = `${fixtureDockerPath}.c`;
  await fs.writeFile(fixtureDockerScriptPath, [
    "#!/bin/sh",
    "remote_home=\"${PACT_FIXTURE_REMOTE_HOME:-$PWD}\"",
    "log_path=\"${PACT_FIXTURE_AGENT_LOG:-}\"",
    "write_log() { [ -n \"$log_path\" ] && printf '%s\\n' \"$1\" >> \"$log_path\"; }",
    "write_opencode() {",
    "  mkdir -p \"$remote_home/.config/opencode\"",
    "  {",
    "    printf '{\\n'",
    "    printf '  \"mcp\": {\\n'",
    "    printf '    \"pact\": {\\n'",
    "    printf '      \"type\": \"remote\",\\n'",
    "    printf '      \"url\": \"%s\",\\n' \"${PACT_URL:-}\"",
    "    printf '      \"headers\": { \"X-Pact-Api-Key\": \"fixture-token\" },\\n'",
    "    printf '      \"enabled\": true\\n'",
    "    printf '    }\\n'",
    "    printf '  }\\n'",
    "    printf '}\\n'",
    "  } > \"$remote_home/.config/opencode/opencode.jsonc\"",
    "}",
    "remove_opencode() {",
    "  mkdir -p \"$remote_home/.config/opencode\"",
    "  printf '{\\n  \"mcp\": {}\\n}\\n' > \"$remote_home/.config/opencode/opencode.jsonc\"",
    "}",
    "write_codex_env() {",
    "  env_name=\"$1\"",
    "  mkdir -p \"$remote_home/.pact/mcp\"",
    "  printf \"export %s='fixture-token-for-remote-codex-verifier'\\n\" \"$env_name\" > \"$remote_home/.pact/mcp/env\"",
    "  if ! grep -q 'Pact MCP token env' \"$remote_home/.profile\" 2>/dev/null; then",
    "    printf '\\n# Pact MCP token env\\n[ -f \"$HOME/.pact/mcp/env\" ] && . \"$HOME/.pact/mcp/env\"\\n' >> \"$remote_home/.profile\"",
    "  fi",
    "}",
    "[ \"${PACT_FIXTURE_DOCKER_HANG:-}\" = \"1\" ] && while :; do :; done",
    "[ \"$1\" = \"ps\" ] && { printf 'box123\\tagentbox\\n'; exit 0; }",
    "[ \"$1\" = \"inspect\" ] && { printf '172.17.0.1\\n'; exit 0; }",
    "[ \"$1\" = \"exec\" ] || exit 1",
    "shift",
    "[ \"$1\" = \"-i\" ] && shift",
    "while [ \"$1\" = \"-e\" ]; do export \"$2\"; shift 2; done",
    "container=\"$1\"",
    "shift",
    "[ \"$container\" = \"box123\" ] || exit 1",
    "if { [ \"$1\" = \"sh\" ] || [ \"$1\" = \"bash\" ]; } && [ \"$2\" = \"-lc\" ]; then",
    "  script=\"$3\"",
    "  case \"$script\" in *\"command_name=\"*\"codex\"*) printf '/usr/local/bin/codex\\n'; exit 0 ;; esac",
    "  case \"$script\" in *\"command_name=\"*\"openclaw\"*) printf '/usr/bin/openclaw\\n'; exit 0 ;; esac",
    "  case \"$script\" in *\"command_name=\"*\"ironclaw\"*) printf '/opt/bin/ironclaw\\n'; exit 0 ;; esac",
    "  case \"$script\" in *\"command_name=\"*) exit 0 ;; esac",
    "  [ -n \"${PACT_TOKEN_ENV:-}\" ] && { write_codex_env \"$PACT_TOKEN_ENV\"; exit 0; }",
    "  case \"$script\" in *\"delete config.mcp.pact\"*) remove_opencode; printf 'removed\\n'; exit 0 ;; esac",
    "  case \"$script\" in *\".config', 'opencode'\"*) write_opencode; exit 0 ;; esac",
    "  case \"$script\" in *\".config/opencode/opencode.jsonc\"*) grep -q '\"pact\"' \"$remote_home/.config/opencode/opencode.jsonc\" 2>/dev/null; exit $? ;; esac",
    "  HOME=\"$remote_home\" sh -lc \"$script\"",
    "  exit $?",
    "fi",
    "if [ \"$1\" = \"env\" ]; then",
    "  shift",
    "  while printf '%s' \"${1:-}\" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*='; do export \"$1\"; shift; done",
    "fi",
    "if { [ \"$1\" = \"/usr/bin/openclaw\" ] || [ \"$1\" = \"/opt/bin/ironclaw\" ]; } && [ \"$2\" = \"mcp\" ]; then",
    "  [ \"$3\" = \"--help\" ] && { printf 'Usage: claw mcp set show unset\\n'; exit 0; }",
    "fi",
    "if [ \"$1\" = \"/usr/local/bin/codex\" ] && [ \"$2\" = \"mcp\" ]; then",
    "  [ \"${PACT_FIXTURE_DOCKER_HANG_MCP:-}\" = \"1\" ] && while :; do :; done",
    "  marker=\"$remote_home/.codex-pact-mcp-installed\"",
    "  case \"$3\" in",
    "    --help) printf 'Usage: codex mcp add get list remove\\n'; exit 0 ;;",
    "    add) mkdir -p \"$remote_home\"; printf 'installed\\n' > \"$marker\"; write_log \"codex|mcp add|$4|$5|$6|$7|$8\"; exit 0 ;;",
    "    remove) rm -f \"$marker\"; exit 0 ;;",
    "    get) [ -f \"$marker\" ] || exit 1; printf 'pact http://127.0.0.1/mcp\\n'; exit 0 ;;",
    "  esac",
    "fi",
    "exit 1",
    ""
  ].join("\n"));
  await fs.writeFile(fixtureDockerSourcePath, [
    "#include <stdlib.h>",
    "#include <unistd.h>",
    "int main(int argc, char **argv) {",
    `  const char *script = ${JSON.stringify(fixtureDockerScriptPath)};`,
    "  char **next = calloc((size_t)argc + 2, sizeof(char *));",
    "  if (!next) return 127;",
    "  next[0] = \"/bin/sh\";",
    "  next[1] = (char *)script;",
    "  for (int i = 1; i < argc; i++) next[i + 1] = argv[i];",
    "  next[argc + 1] = 0;",
    "  execv(\"/bin/sh\", next);",
    "  return 127;",
    "}",
    ""
  ].join("\n"));
  const compile = await runProcess("cc", [fixtureDockerSourcePath, "-o", fixtureDockerPath], 10000);
  return compile.code === 0;
}

let serverUrl = "";
console.log("\n=== Pact Agent Target MCP Install Verification ===\n");

let server;
try {
  server = await startHttpServer({
    userDataPath,
    distPath: "",
    port: 0,
    runtimeOptions: { profile: "minimal" }
  });
  serverUrl = server.url;
  console.log(`Server: ${serverUrl}`);
} catch (error) {
  console.error(`FAIL: could not start server: ${error.message}`);
  process.exit(1);
}
await installAuthenticatedFetch(server);

try {
  // ── SECTION 1: Server readiness ──
  console.log("\n[1] Server readiness");
  await testAsync("discovery endpoint", async () => {
    const d = await fetchJson(`${serverUrl}/api/mcp/discovery`);
    assert.equal(d.status, 200);
    assert.equal(d.payload.name, "Pact");
  });
  await testAsync("handshake verification", async () => {
    const nonce = randomBytes(32).toString("base64url");
    const h = await fetchJson(`${serverUrl}/api/mcp/handshake`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce, client: { name: "opencode-test", version: "1" } })
    });
    assert.equal(h.status, 200);
    assert.equal(h.payload.ok, true);
    assert.equal(h.payload.payload.nonce, nonce);
  });

  // ── SECTION 2: Token acquisition ──
  console.log("\n[2] Token acquisition");
  let token = "";
  let localGrantId = "";
  await testAsync("local-grant for opencode", async () => {
    const g = await fetchJson(`${serverUrl}/api/mcp/local-grant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets: ["opencode"], label: "opencode-test", connectorVersion: "verify" })
    });
    assert.equal(g.status, 201);
    assert.ok(g.payload.token);
    assert.deepEqual(g.payload.targets, ["opencode"]);
    token = g.payload.token;
    localGrantId = g.payload.grant?.id || "";
    assert.ok(localGrantId);
  });
  await testAsync("discovery clients includes opencode after grant", async () => {
    const clients = await fetchJson(`${serverUrl}/api/discovery/clients`);
    assert.equal(clients.status, 200);
    assert.ok(
      clients.payload.items?.some((item) => item.sourceGrantId === localGrantId && item.clientLabel === "opencode"),
      "opencode grant should be visible as a current MCP client"
    );
  });
  await testAsync("MCP tools/list with token", async () => {
    const t = await fetchJson(`${serverUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pact-Api-Key": token },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    });
    assert.equal(t.status, 200);
    assert.ok(t.payload.result?.tools?.length > 0);
  });
  await testAsync("local-grant target match for all supported agents", async () => {
    for (const [target, profileId] of Object.entries(EXPECTED_AGENT_PROFILES)) {
      const g = await fetchJson(`${serverUrl}/api/mcp/local-grant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: [target], label: `${target}-test`, connectorVersion: "verify" })
      });
      assert.equal(g.status, 201, `${target} should issue local grant`);
      assert.equal(g.payload.targetMatch?.matched, true, `${target} should match an agent profile`);
      assert.deepEqual(g.payload.targetMatch?.matchedTargets, [target]);
      assert.equal(g.payload.targetMatch?.agentProfileId, profileId);
      assert.ok(g.payload.toolsets?.includes("pact.agent.workspace"), `${target} should include workspace toolset`);
    }
  });
  await testAsync("refresh opencode grant for connector install flow", async () => {
    const g = await fetchJson(`${serverUrl}/api/mcp/local-grant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets: ["opencode"], label: "opencode-install-test", connectorVersion: "verify" })
    });
    assert.equal(g.status, 201);
    assert.ok(g.payload.token);
    token = g.payload.token;
    localGrantId = g.payload.grant?.id || "";
    assert.ok(localGrantId);
  });

  // ── SECTION 3: OpenCode config manipulation ──
  console.log("\n[3] OpenCode config manipulation");

  await testAsync("install to clean config", async () => {
    const clean = { "$schema": "https://opencode.ai/config.json" };
    await fs.writeFile(opencodeConfigPath, JSON.stringify(clean, null, 2));
    clean.mcp = { pact: { type: "remote", url: `${serverUrl}/mcp`, headers: { "X-Pact-Api-Key": token }, enabled: true } };
    await fs.writeFile(opencodeConfigPath, JSON.stringify(clean, null, 2));
    const r = JSON.parse(await fs.readFile(opencodeConfigPath, "utf8"));
    assert.equal(r.mcp?.pact?.type, "remote");
    assert.equal(r.mcp?.pact?.url, `${serverUrl}/mcp`);
    assert.equal(r.mcp?.pact?.headers?.["X-Pact-Api-Key"], token);
    assert.equal(r.mcp?.pact?.enabled, true);
  });

  await testAsync("install preserves existing entries", async () => {
    const cfg = {
      "$schema": "https://opencode.ai/config.json",
      "mcp": {
        "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp" },
        "sentry": { "type": "remote", "url": "https://mcp.sentry.dev/mcp", "oauth": {} }
      }
    };
    await fs.writeFile(opencodeConfigPath, JSON.stringify(cfg, null, 2));
    const config = JSON.parse(await fs.readFile(opencodeConfigPath, "utf8"));
    config.mcp.pact = { type: "remote", url: `${serverUrl}/mcp`, headers: { "X-Pact-Api-Key": token }, enabled: true };
    await fs.writeFile(opencodeConfigPath, JSON.stringify(config, null, 2));
    const r = JSON.parse(await fs.readFile(opencodeConfigPath, "utf8"));
    assert.equal(Object.keys(r.mcp).length, 3);
    assert.ok(r.mcp.context7);
    assert.ok(r.mcp.sentry);
    assert.ok(r.mcp.pact);
  });

  await testAsync("re-install overwrites token", async () => {
    const config = JSON.parse(await fs.readFile(opencodeConfigPath, "utf8"));
    config.mcp.pact.headers["X-Pact-Api-Key"] = "new-token-v2";
    await fs.writeFile(opencodeConfigPath, JSON.stringify(config, null, 2));
    const r = JSON.parse(await fs.readFile(opencodeConfigPath, "utf8"));
    assert.equal(r.mcp.pact.headers["X-Pact-Api-Key"], "new-token-v2");
  });

  await testAsync("uninstall removes pact, preserves others", async () => {
    const config = JSON.parse(await fs.readFile(opencodeConfigPath, "utf8"));
    assert.ok(config.mcp.pact, "pact should exist");
    delete config.mcp.pact;
    await fs.writeFile(opencodeConfigPath, JSON.stringify(config, null, 2));
    const r = JSON.parse(await fs.readFile(opencodeConfigPath, "utf8"));
    assert.equal(r.mcp.pact, undefined);
    assert.equal(Object.keys(r.mcp).length, 2);
  });

  await testAsync("uninstall when not installed (no-op)", async () => {
    const before = JSON.parse(await fs.readFile(opencodeConfigPath, "utf8"));
    assert.equal(before.mcp.pact, undefined);
    const after = JSON.parse(await fs.readFile(opencodeConfigPath, "utf8"));
    assert.deepEqual(after, before);
  });

  // ── SECTION 4: End-to-end CLI install ──
  console.log("\n[4] End-to-end CLI install --target opencode");
  let cliInstallResult = null;
  await testAsync("cli install succeeds", async () => {
    cliInstallResult = await spawnConnector([
      "install",
      "--target", "opencode",
      "--url", serverUrl,
      "--token", token,
      "--opencode-config", opencodeConfigPath,
      "--discovery-file", tempRegistryPath,
      "--no-verify"
    ]);
    if (cliInstallResult.code !== 0) {
      console.log(`\n      stdout: ${cliInstallResult.stdout.slice(0, 200)}`);
      console.log(`      stderr: ${cliInstallResult.stderr.slice(0, 200)}`);
    }
    assert.equal(cliInstallResult.code, 0, `exit code ${cliInstallResult.code}`);

    const config = JSON.parse(await fs.readFile(opencodeConfigPath, "utf8"));
    assert.equal(config.mcp?.pact?.type, "remote");
    assert.equal(config.mcp?.pact?.url, `${serverUrl}/mcp`);
    assert.ok(config.mcp?.pact?.enabled);
    assert.ok(config.mcp?.pact?.headers?.["X-Pact-Api-Key"]);
  });

  await testAsync("cli install human output mentions opencode", () => {
    const output = cliInstallResult.stdout;
    assert.ok(
      output.includes("opencode") || output.includes("OpenCode"),
      `Output should mention opencode: ${output.slice(0, 200)}`
    );
    assert.match(output, /OpenCode quick test:/);
    assert.match(output, /X-Pact-Api-Key: <token>/);
    assert.equal(output.includes(token), false, "human install output must not expose the grant token");
  });

  await testAsync("cli remote opencode install writes remote config", async () => {
    const canRun = await installFixtureDockerRuntime();
    if (!canRun) {
      return;
    }
    const result = await spawnConnector([
      "install",
      "--target", "opencode",
      "--url", serverUrl,
      "--token", token,
      "--execution-location", "docker",
      "--remote-kind", "docker",
      "--remote-id", "box123",
      "--remote-name", "agentbox",
      "--remote-bin", fixtureDockerPath,
      "--discovery-file", remoteOpenCodeRegistryPath,
      "--no-verify",
      "--json"
    ], 60000, {
      PACT_FIXTURE_REMOTE_HOME: remoteOpenCodeHome
    });
    if (result.code !== 0) {
      console.log(`\n      stdout: ${result.stdout.slice(0, 300)}`);
      console.log(`      stderr: ${result.stderr.slice(0, 300)}`);
    }
    assert.equal(result.code, 0, `exit code ${result.code}`);
    assert.equal(result.stdout.includes(token), false, "remote install output must not expose the grant token");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.installed?.opencode?.status, "installed");
    assert.equal(payload.installed?.opencode?.installMode, "opencode-docker-mcp-config");

    const remoteConfig = JSON.parse(await fs.readFile(path.join(remoteOpenCodeHome, ".config", "opencode", "opencode.jsonc"), "utf8"));
    assert.equal(remoteConfig.mcp?.pact?.type, "remote");
    assert.match(remoteConfig.mcp?.pact?.url || "", /\/mcp$/);
    assert.ok(remoteConfig.mcp?.pact?.headers?.["X-Pact-Api-Key"]);
  });

  await testAsync("scan detects remote codex in container", async () => {
    const canRun = await installFixtureDockerRuntime();
    if (!canRun) {
      return;
    }
    const result = await spawnConnector([
      "scan",
      "--json",
      "--url", serverUrl,
      "--orb-bin", unavailableToolPaths.orb,
      "--docker-bin", fixtureDockerPath,
      "--podman-bin", unavailableToolPaths.podman,
      "--nerdctl-bin", unavailableToolPaths.nerdctl,
      "--wsl-bin", unavailableToolPaths.wsl,
      "--lima-bin", unavailableToolPaths.lima,
      "--colima-bin", unavailableToolPaths.colima,
      "--multipass-bin", unavailableToolPaths.multipass,
      "--lxc-bin", unavailableToolPaths.lxc,
      "--incus-bin", unavailableToolPaths.incus,
      "--vagrant-bin", unavailableToolPaths.vagrant,
      "--parallels-bin", unavailableToolPaths.parallels
    ], 60000, {
      PACT_FIXTURE_REMOTE_HOME: remoteOpenCodeHome,
      PACT_FIXTURE_AGENT_LOG: fixtureAgentCommandLog
    });
    if (result.code !== 0) {
      console.log(`\n      stdout: ${result.stdout.slice(0, 600)}`);
      console.log(`      stderr: ${result.stderr.slice(0, 600)}`);
    }
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    const remoteCodex = payload.candidates?.find((candidate) =>
      candidate.target === "codex" &&
        candidate.optionOverrides?.["execution-location"] === "docker"
    );
    assert.ok(remoteCodex, "remote Docker Codex should be detected");
    assert.equal(remoteCodex.optionOverrides?.["codex-bin"], "/usr/local/bin/codex");
    assert.ok(remoteCodex.installCommand?.includes("--target codex"));
    assert.ok(remoteCodex.installCommand?.includes("--execution-location"));
  });

  await testAsync("scan preserves remote openclaw-compatible alternatives", async () => {
    const canRun = await installFixtureDockerRuntime();
    if (!canRun) {
      return;
    }
    const result = await spawnConnector([
      "scan",
      "--json",
      "--url", serverUrl,
      "--orb-bin", unavailableToolPaths.orb,
      "--docker-bin", fixtureDockerPath,
      "--podman-bin", unavailableToolPaths.podman,
      "--nerdctl-bin", unavailableToolPaths.nerdctl,
      "--wsl-bin", unavailableToolPaths.wsl,
      "--lima-bin", unavailableToolPaths.lima,
      "--colima-bin", unavailableToolPaths.colima,
      "--multipass-bin", unavailableToolPaths.multipass,
      "--lxc-bin", unavailableToolPaths.lxc,
      "--incus-bin", unavailableToolPaths.incus,
      "--vagrant-bin", unavailableToolPaths.vagrant,
      "--parallels-bin", unavailableToolPaths.parallels
    ], 60000, {
      PACT_FIXTURE_REMOTE_HOME: remoteOpenCodeHome,
      PACT_FIXTURE_AGENT_LOG: fixtureAgentCommandLog
    });
    if (result.code !== 0) {
      console.log(`\n      stdout: ${result.stdout.slice(0, 600)}`);
      console.log(`      stderr: ${result.stderr.slice(0, 600)}`);
    }
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    const remoteOpenClawCandidates = (payload.candidates || []).filter((candidate) =>
      candidate.target === "openclaw" &&
        candidate.optionOverrides?.["execution-location"] === "docker"
    );
    const bins = remoteOpenClawCandidates
      .map((candidate) => candidate.optionOverrides?.["openclaw-bin"])
      .sort();
    assert.deepEqual(bins, ["/opt/bin/ironclaw", "/usr/bin/openclaw"]);
    for (const candidate of remoteOpenClawCandidates) {
      assert.ok(candidate.installCommand?.includes("--target openclaw"));
      assert.ok(candidate.installCommand?.includes("--openclaw-bin"));
    }
  });

  await testAsync("cli remote codex install and uninstall use remote context", async () => {
    const canRun = await installFixtureDockerRuntime();
    if (!canRun) {
      return;
    }
    const install = await spawnConnector([
      "install",
      "--target", "codex",
      "--url", serverUrl,
      "--token", token,
      "--token-env", remoteCodexTokenEnv,
      "--execution-location", "docker",
      "--remote-kind", "docker",
      "--remote-id", "box123",
      "--remote-name", "agentbox",
      "--remote-bin", fixtureDockerPath,
      "--codex-bin", "/usr/local/bin/codex",
      "--discovery-file", remoteCodexRegistryPath,
      "--no-verify",
      "--json"
    ], 60000, {
      PACT_FIXTURE_REMOTE_HOME: remoteOpenCodeHome,
      PACT_FIXTURE_AGENT_LOG: fixtureAgentCommandLog
    });
    if (install.code !== 0) {
      console.log(`\n      stdout: ${install.stdout.slice(0, 300)}`);
      console.log(`      stderr: ${install.stderr.slice(0, 300)}`);
    }
    assert.equal(install.code, 0, `exit code ${install.code}`);
    assert.equal(install.stdout.includes(token), false, "remote Codex install output must not expose the grant token");
    const installPayload = JSON.parse(install.stdout);
    assert.equal(installPayload.ok, true);
    assert.equal(installPayload.installed?.codex?.status, "installed");
    assert.equal(installPayload.installed?.codex?.installMode, "codex-docker-mcp-cli");
    const remoteEnv = await fs.readFile(path.join(remoteOpenCodeHome, ".pact", "mcp", "env"), "utf8");
    assert.match(remoteEnv, new RegExp(`export ${remoteCodexTokenEnv}=`));
    const commandLog = await fs.readFile(fixtureAgentCommandLog, "utf8");
    assert.match(commandLog, /codex\|mcp add\|pact\|--url/);
    assert.equal(commandLog.includes(token), false, "remote Codex command log must not expose token values");

    const uninstall = await spawnConnector([
      "uninstall",
      "--target", "codex",
      "--execution-location", "docker",
      "--remote-kind", "docker",
      "--remote-id", "box123",
      "--remote-name", "agentbox",
      "--remote-bin", fixtureDockerPath,
      "--codex-bin", "/usr/local/bin/codex",
      "--discovery-file", remoteCodexRegistryPath,
      "--json"
    ], 60000, {
      PACT_FIXTURE_REMOTE_HOME: remoteOpenCodeHome
    });
    assert.equal(uninstall.code, 0, uninstall.stderr || uninstall.stdout);
    const uninstallPayload = JSON.parse(uninstall.stdout);
    assert.equal(uninstallPayload.ok, true);
    assert.equal(uninstallPayload.uninstalled?.codex?.status, "not-installed");
    assert.equal(uninstallPayload.uninstalled?.codex?.uninstallMode, "codex-docker-mcp-cli");
  });

  await testAsync("cli remote codex install times out stalled remote context", async () => {
    const canRun = await installFixtureDockerRuntime();
    if (!canRun) {
      return;
    }
    const result = await spawnConnector([
      "install",
      "--target", "codex",
      "--url", serverUrl,
      "--token", token,
      "--token-env", remoteCodexTokenEnv,
      "--execution-location", "docker",
      "--remote-kind", "docker",
      "--remote-id", "box123",
      "--remote-name", "agentbox",
      "--remote-bin", fixtureDockerPath,
      "--codex-bin", "/usr/local/bin/codex",
      "--discovery-file", remoteCodexRegistryPath,
      "--no-verify",
      "--json"
    ], 15000, {
      PACT_FIXTURE_REMOTE_HOME: remoteOpenCodeHome,
      PACT_FIXTURE_DOCKER_HANG: "1",
      PACT_MCP_INSTALL_COMMAND_TIMEOUT_MS: "1000"
    });
    assert.equal(result.code, 1);
    assert.equal(result.stdout.includes(token), false, "timeout failure output must not expose the grant token");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.installed?.codex?.status, "failed");
    assert.match(payload.installed?.codex?.error, /timed out/);
  });

  await testAsync("cli remote codex install times out stalled mcp command", async () => {
    const canRun = await installFixtureDockerRuntime();
    if (!canRun) {
      return;
    }
    const result = await spawnConnector([
      "install",
      "--target", "codex",
      "--url", serverUrl,
      "--token", token,
      "--token-env", remoteCodexTokenEnv,
      "--execution-location", "docker",
      "--remote-kind", "docker",
      "--remote-id", "box123",
      "--remote-name", "agentbox",
      "--remote-bin", fixtureDockerPath,
      "--codex-bin", "/usr/local/bin/codex",
      "--discovery-file", remoteCodexRegistryPath,
      "--no-verify",
      "--json"
    ], 15000, {
      PACT_FIXTURE_REMOTE_HOME: remoteOpenCodeHome,
      PACT_FIXTURE_DOCKER_HANG_MCP: "1",
      PACT_MCP_INSTALL_COMMAND_TIMEOUT_MS: "1000"
    });
    assert.equal(result.code, 1);
    assert.equal(result.stdout.includes(token), false, "remote MCP command timeout output must not expose the grant token");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.installed?.codex?.status, "failed");
    assert.match(payload.installed?.codex?.error, /timed out/);
  });

  await testAsync("cli local claude install times out stalled mcp command", async () => {
    await installFixtureAgentCli(fixtureClaudeHangPath);
    const result = await spawnConnector([
      "install",
      "--target", "claude-code",
      "--url", serverUrl,
      "--token", token,
      "--claude-bin", fixtureClaudeHangPath,
      "--discovery-file", tempRegistryPath,
      "--no-verify",
      "--json"
    ], 10000, {
      PACT_FIXTURE_AGENT_HANG_MCP: path.basename(fixtureClaudeHangPath, path.extname(fixtureClaudeHangPath)),
      PACT_MCP_INSTALL_COMMAND_TIMEOUT_MS: "1000"
    });
    assert.equal(result.code, 1);
    assert.equal(result.stdout.includes(token), false, "local Claude timeout output must not expose the grant token");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.installed?.["claude-code"]?.status, "failed");
    assert.match(payload.installed?.["claude-code"]?.error, /timed out/);
    assert.match(payload.installed?.["claude-code"]?.error, /<local-path>/);
    assert.equal(result.stdout.includes(fixtureClaudeHangPath), false, "local Claude timeout output must not expose the agent binary path");
    assert.equal(result.stdout.includes(path.dirname(fixtureClaudeHangPath)), false, "local Claude timeout output must not expose the agent binary directory");
  });

  await testAsync("cli local openclaw install times out stalled mcp command", async () => {
    await installFixtureAgentCli(fixtureOpenClawHangPath);
    const result = await spawnConnector([
      "install",
      "--target", "openclaw",
      "--url", serverUrl,
      "--token", token,
      "--openclaw-bin", fixtureOpenClawHangPath,
      "--discovery-file", tempRegistryPath,
      "--no-verify",
      "--json"
    ], 10000, {
      PACT_FIXTURE_AGENT_HANG_MCP: path.basename(fixtureOpenClawHangPath, path.extname(fixtureOpenClawHangPath)),
      PACT_MCP_INSTALL_COMMAND_TIMEOUT_MS: "1000"
    });
    assert.equal(result.code, 1);
    assert.equal(result.stdout.includes(token), false, "local OpenClaw timeout output must not expose the grant token");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.installed?.openclaw?.status, "failed");
    assert.match(payload.installed?.openclaw?.error, /timed out/);
    assert.match(payload.installed?.openclaw?.error, /<local-path>/);
    assert.equal(result.stdout.includes(fixtureOpenClawHangPath), false, "local OpenClaw timeout output must not expose the agent binary path");
    assert.equal(result.stdout.includes(path.dirname(fixtureOpenClawHangPath)), false, "local OpenClaw timeout output must not expose the agent binary directory");
  });

  await testAsync("cli local gemini install times out stalled mcp command", async () => {
    await installFixtureAgentCli(fixtureGeminiHangPath);
    const result = await spawnConnector([
      "install",
      "--target", "gemini-cli",
      "--url", serverUrl,
      "--token", token,
      "--gemini-bin", fixtureGeminiHangPath,
      "--discovery-file", tempRegistryPath,
      "--no-verify",
      "--json"
    ], 10000, {
      PACT_FIXTURE_AGENT_HANG_MCP: path.basename(fixtureGeminiHangPath, path.extname(fixtureGeminiHangPath)),
      PACT_MCP_INSTALL_COMMAND_TIMEOUT_MS: "1000"
    });
    assert.equal(result.code, 1);
    assert.equal(result.stdout.includes(token), false, "local Gemini timeout output must not expose the grant token");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.installed?.["gemini-cli"]?.status, "failed");
    assert.match(payload.installed?.["gemini-cli"]?.error, /timed out/);
  });

  await testAsync("cli local copilot install times out stalled mcp command", async () => {
    await installFixtureAgentCli(fixtureCopilotHangPath);
    const result = await spawnConnector([
      "install",
      "--target", "copilot",
      "--url", serverUrl,
      "--token", token,
      "--copilot-bin", fixtureCopilotHangPath,
      "--discovery-file", tempRegistryPath,
      "--no-verify",
      "--json"
    ], 10000, {
      PACT_FIXTURE_AGENT_HANG_MCP: path.basename(fixtureCopilotHangPath, path.extname(fixtureCopilotHangPath)),
      PACT_MCP_INSTALL_COMMAND_TIMEOUT_MS: "1000"
    });
    assert.equal(result.code, 1);
    assert.equal(result.stdout.includes(token), false, "local Copilot timeout output must not expose the grant token");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.installed?.copilot?.status, "failed");
    assert.match(payload.installed?.copilot?.error, /timed out/);
  });

  await testAsync("cli local kilo install ignores stalled optional list command", async () => {
    await installFixtureAgentCli(fixtureKiloHangPath);
    const result = await spawnConnector([
      "install",
      "--target", "kilo-code",
      "--url", serverUrl,
      "--token", token,
      "--kilo-bin", fixtureKiloHangPath,
      "--kilo-config", hangKiloConfigPath,
      "--discovery-file", tempRegistryPath,
      "--no-verify",
      "--json"
    ], 10000, {
      PACT_FIXTURE_AGENT_HANG_MCP: path.basename(fixtureKiloHangPath, path.extname(fixtureKiloHangPath)),
      PACT_MCP_INSTALL_COMMAND_TIMEOUT_MS: "1000"
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes(token), false, "local Kilo output must not expose the grant token");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.installed?.["kilo-code"]?.status, "installed");
    const config = JSON.parse(await fs.readFile(hangKiloConfigPath, "utf8"));
    assert.equal(config.mcp?.pact?.url, `${serverUrl}/mcp`);
  });

  await testAsync("cli local gemini failure redacts echoed token arguments", async () => {
    await installFixtureAgentCli(fixtureGeminiFailPath);
    const result = await spawnConnector([
      "install",
      "--target", "gemini-cli",
      "--url", serverUrl,
      "--token", token,
      "--gemini-bin", fixtureGeminiFailPath,
      "--discovery-file", tempRegistryPath,
      "--no-verify",
      "--json"
    ], 10000, {
      PACT_FIXTURE_AGENT_FAIL_WITH_ARGS: "1"
    });
    assert.equal(result.code, 1);
    assert.equal(result.stdout.includes(token), false, "local Gemini failure output must not expose echoed token arguments");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.installed?.["gemini-cli"]?.status, "failed");
    assert.match(payload.installed?.["gemini-cli"]?.error, /<redacted-token>/);
    assert.match(payload.installed?.["gemini-cli"]?.error, /<local-path>/);
    assert.equal(result.stdout.includes(fixtureGeminiFailPath), false, "local Gemini failure output must not expose the agent binary path");
    assert.equal(result.stdout.includes(path.dirname(fixtureGeminiFailPath)), false, "local Gemini failure output must not expose the agent binary directory");
  });

  // ── SECTION 5: Non-interactive auto install ──
  console.log("\n[5] Non-interactive auto install");
  await testAsync("--target auto installs explicitly detected supported agents", async () => {
    await installFixturePriorityAgentClis();
    await fs.mkdir(path.dirname(autoAntigravityConfigPath), { recursive: true });
    const result = await spawnConnector([
      "install",
      "--target", "auto",
      "--url", serverUrl,
      "--token", token,
      "--token-env", autoTokenEnv,
      "--codex-bin", fixtureCodexPath,
      "--claude-bin", fixtureClaudePath,
      "--gemini-bin", fixtureGeminiPath,
      "--kilo-bin", fixtureKiloPath,
      "--copilot-bin", fixtureCopilotPath,
      "--openclaw-bin", fixtureOpenClawPath,
      "--opencode-bin", fixtureOpencodePath,
      "--marketplace-root", autoMarketplaceRoot,
      "--kilo-config", autoKiloConfigPath,
      "--opencode-config", autoOpencodeConfigPath,
      "--antigravity-config", autoAntigravityConfigPath,
      "--discovery-file", autoRegistryPath,
      "--no-scan",
      "--no-verify",
      "--json"
    ], 60000, {
      PATH: `${fixtureBinDir}${path.delimiter}${process.env.PATH || ""}`,
      PACT_FIXTURE_AGENT_LOG: fixtureAgentCommandLog,
      PACT_FIXTURE_AGENT_HANG_MCP: ""
    });
    if (result.code !== 0) {
      console.log(`\n      stdout: ${result.stdout.slice(0, 300)}`);
      console.log(`      stderr: ${result.stderr.slice(0, 300)}`);
    }
    assert.equal(result.code, 0, `exit code ${result.code}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true, JSON.stringify(payload, null, 2));
    assert.equal(payload.autoDetected, true);
    const selectedTargets = payload.selected?.map((item) => item.target) || [];
    for (const target of PRIORITY_AGENT_TARGETS) {
      assert.equal(selectedTargets.includes(target), true, `${target} should be selected by auto install: ${selectedTargets.join(", ")}`);
    }
    assert.equal(payload.selected?.some((item) => item.target === "gemini-cli"), true, "gemini-cli should be selected by auto install");
    assert.equal(payload.selected?.some((item) => item.target === "kilo-code"), true, "kilo-code should be selected by auto install");
    assert.equal(payload.selected?.some((item) => item.target === "copilot"), true, "copilot should be selected by auto install");
    assert.equal(payload.selected?.some((item) => item.target === "antigravity"), true, "antigravity should be selected by auto install");
    assert.equal(payload.selected?.some((item) => item.target === "opencode"), true, "opencode should be selected by auto install");
    for (const target of PRIORITY_AGENT_TARGETS) {
      assert.equal(payload.installed?.[target]?.status, "installed", `${target} should be installed by auto install`);
    }
    for (const target of PRIORITY_AGENT_TARGETS) {
      const selected = payload.selected?.find((item) => item.target === target);
      assert.ok(selected?.installCommand?.includes(`pact-mcp install --target ${target}`), `${target} should include a copyable install command`);
      assert.ok(["supported", "inconclusive"].includes(selected.mcpProbe), `${target} should include explicit-bin probe state`);
      assert.equal(selected.installCommand.includes(token), false, `${target} install command must not expose token values`);
    }
    assert.equal(payload.installed?.["gemini-cli"]?.status, "installed");
    assert.equal(payload.installed?.["kilo-code"]?.status, "installed");
    assert.equal(payload.installed?.copilot?.status, "installed");
    assert.equal(payload.installed?.antigravity?.status, "installed");
    assert.equal(payload.installed?.opencode?.status, "installed");

    const config = JSON.parse(await fs.readFile(autoOpencodeConfigPath, "utf8"));
    assert.equal(config.mcp?.pact?.type, "remote");
    assert.equal(config.mcp?.pact?.url, `${serverUrl}/mcp`);
    assert.ok(config.mcp?.pact?.headers?.["X-Pact-Api-Key"]);
    const manifest = JSON.parse(await fs.readFile(autoRegistryPath, "utf8"));
    const npxPrefix = `npx pact-mcp-connector@${payload.packageVersion}`;
    const connector = manifest.servers?.pact?.connector || {};
    assert.equal(connector.registerCommand, `${npxPrefix} register --url '${serverUrl}' --token-env '${autoTokenEnv}'`);
    assert.equal(connector.interactiveInstallCommand, `${npxPrefix} install --url '${serverUrl}' --token-env '${autoTokenEnv}'`);
    assert.equal(connector.githubOneLineCommand, RELEASE_BOOTSTRAP);
    assert.equal(connector.githubOneLineInstallCommand, `${RELEASE_BOOTSTRAP} -- --url '${serverUrl}' --token-env '${autoTokenEnv}'`);
    assert.equal(connector.githubOneLineClientInstallJsonCommand, `${RELEASE_BOOTSTRAP} -- --target <client> --url '${serverUrl}' --token-env '${autoTokenEnv}' --json`);
    assert.equal(connector.githubOneLineAutoInstallCommand, `${RELEASE_BOOTSTRAP} -- --target auto --url '${serverUrl}' --token-env '${autoTokenEnv}' --json`);
    assert.equal(connector.githubOneLinePriorityInstallCommand, `${RELEASE_BOOTSTRAP} -- --target claude-code,codex,openclaw --url '${serverUrl}' --token-env '${autoTokenEnv}' --json`);
    assert.equal(connector.githubOneLineCommandZhCN, RELEASE_BOOTSTRAP_ZH_CN);
    assert.equal(connector.githubOneLineInstallCommandZhCN, `${RELEASE_BOOTSTRAP_ZH_CN} -- --url '${serverUrl}' --token-env '${autoTokenEnv}'`);
    assert.equal(connector.githubOneLineClientInstallJsonCommandZhCN, `${RELEASE_BOOTSTRAP_ZH_CN} -- --target <client> --url '${serverUrl}' --token-env '${autoTokenEnv}' --json`);
    assert.equal(connector.githubOneLineAutoInstallCommandZhCN, `${RELEASE_BOOTSTRAP_ZH_CN} -- --target auto --url '${serverUrl}' --token-env '${autoTokenEnv}' --json`);
    assert.equal(connector.githubOneLinePriorityInstallCommandZhCN, `${RELEASE_BOOTSTRAP_ZH_CN} -- --target claude-code,codex,openclaw --url '${serverUrl}' --token-env '${autoTokenEnv}' --json`);
    assert.equal(connector.oneCommandInstall, connector.githubOneLineInstallCommand);
    assert.equal(connector.oneCommandInstallZhCN, connector.githubOneLineInstallCommandZhCN);
    assert.equal(connector.oneCommandClientInstallJson, connector.githubOneLineClientInstallJsonCommand);
    assert.equal(connector.oneCommandClientInstallJsonZhCN, connector.githubOneLineClientInstallJsonCommandZhCN);
    assert.equal(connector.oneCommandAutoInstall, connector.githubOneLineAutoInstallCommand);
    assert.equal(connector.oneCommandAutoInstallZhCN, connector.githubOneLineAutoInstallCommandZhCN);
    assert.equal(connector.oneCommandPriorityInstall, connector.githubOneLinePriorityInstallCommand);
    assert.equal(connector.oneCommandPriorityInstallZhCN, connector.githubOneLinePriorityInstallCommandZhCN);
    assert.equal(connector.autoInstallCommand, `${npxPrefix} install --target auto --url '${serverUrl}' --token-env '${autoTokenEnv}' --json`);
    assert.equal(connector.priorityInstallCommand, `${npxPrefix} install --target claude-code,codex,openclaw --url '${serverUrl}' --token-env '${autoTokenEnv}' --json`);
    assert.deepEqual(connector.priorityTargets, ["claude-code", "codex", "openclaw"]);
    assert.deepEqual(connector.supportedTargets, DECLARED_AGENT_TARGETS);
    const connectorTargetDetails = new Map(connector.supportedTargetDetails.map((target) => [target.target, target]));
    assert.deepEqual([...connectorTargetDetails.keys()], DECLARED_AGENT_TARGETS);
    assert.equal(connectorTargetDetails.get("claude-code").label, "Claude Code");
    assert.equal(connectorTargetDetails.get("opencode").priority, true);
    assert.deepEqual(connectorTargetDetails.get("hermes").locations, ["orbstack", "remote-linux"]);
    assert.equal(connector.installCommand, `${npxPrefix} install --target <client> --url '${serverUrl}' --token-env '${autoTokenEnv}'`);
    assert.equal(connector.clientInstallJsonCommand, `${npxPrefix} install --target <client> --url '${serverUrl}' --token-env '${autoTokenEnv}' --json`);
    assert.equal(connector.uninstallCommand, `${npxPrefix} uninstall --target <client> --url '${serverUrl}'`);
    assert.equal(connector.discoverCommand, `${npxPrefix} discover-local --url '${serverUrl}' --json`);
    assert.equal(connector.scanCommand, `${npxPrefix} scan --url '${serverUrl}' --token-env '${autoTokenEnv}' --json`);
    assert.equal(connector.doctorCommand, `${npxPrefix} doctor --url '${serverUrl}' --token-env '${autoTokenEnv}' --json`);
    assert.equal(manifest.servers?.pact?.upgrade?.listChanged, true);
    assert.equal(manifest.servers?.pact?.upgrade?.notification, "notifications/tools/list_changed");
    assert.equal(manifest.servers?.pact?.upgrade?.reinstallCommand, connector.githubOneLineInstallCommand);
    assert.equal(manifest.servers?.pact?.upgrade?.clientReinstallJsonCommand, connector.githubOneLineClientInstallJsonCommand);
    assert.equal(manifest.servers?.pact?.upgrade?.agentReinstallCommand, connector.githubOneLineAutoInstallCommand);
    assert.equal(manifest.servers?.pact?.upgrade?.priorityAgentReinstallCommand, connector.githubOneLinePriorityInstallCommand);
    assert.equal(manifest.servers?.pact?.upgrade?.agentReinstallCommandZhCN, connector.githubOneLineAutoInstallCommandZhCN);
    assert.equal(manifest.servers?.pact?.upgrade?.priorityAgentReinstallCommandZhCN, connector.githubOneLinePriorityInstallCommandZhCN);
    assert.equal(manifest.servers?.pact?.upgrade?.oneCommandAgentReinstallZhCN, connector.githubOneLineAutoInstallCommandZhCN);
    assert.deepEqual(manifest.servers?.pact?.upgrade?.priorityTargets, ["claude-code", "codex", "openclaw"]);
    assert.equal(manifest.servers?.pact?.auth?.tokenEnv, autoTokenEnv);
    assert.equal(manifest.servers?.pact?.sharedHub?.sharedspace?.outlet, "pact.sharedspace");
    assert.equal(manifest.servers?.pact?.sharedHub?.sharedspace?.referencePolicy, "use-public-workspace-ref");
    assert.equal(manifest.servers?.pact?.sharedHub?.sharedspace?.exchangeReceipt?.schemaVersion, "pact.mcp.sharedspace-exchange.v1");
    assert.ok(manifest.servers?.pact?.sharedHub?.sharedspace?.exchangeReceipt?.fields?.includes("outlet"));
    assert.ok(manifest.servers?.pact?.sharedHub?.sharedspace?.exchangeReceipt?.fields?.includes("referencePolicy"));
    assert.ok(manifest.servers?.pact?.sharedHub?.sharedspace?.coreOperations?.includes("pact.sharedspace.file.write"));
    assert.equal(manifest.servers?.pact?.codex?.tokenEnv, autoTokenEnv);
    assert.equal(manifest.servers?.pact?.codex?.installCommand, `${npxPrefix} install --target codex --url '${serverUrl}' --token-env '${autoTokenEnv}'`);
    assert.ok(manifest.discovery?.lookupOrder?.includes("pact-mcp discover-local --json"));
    const uninstallResult = await spawnConnector([
      "uninstall",
      "--target", "openclaw",
      "--url", serverUrl,
      "--openclaw-bin", fixtureOpenClawPath,
      "--discovery-file", autoRegistryPath,
      "--json"
    ]);
    assert.equal(uninstallResult.code, 0);
    const manifestAfterUninstall = JSON.parse(await fs.readFile(autoRegistryPath, "utf8"));
    assert.equal(manifestAfterUninstall.servers?.pact?.auth?.tokenEnv, autoTokenEnv);
    assert.equal(manifestAfterUninstall.servers?.pact?.connector?.scanCommand, `${npxPrefix} scan --url '${serverUrl}' --token-env '${autoTokenEnv}' --json`);
    const kiloConfig = JSON.parse(await fs.readFile(autoKiloConfigPath, "utf8"));
    assert.equal(kiloConfig.mcp?.pact?.type, "remote");
    assert.equal(kiloConfig.mcp?.pact?.url, `${serverUrl}/mcp`);
    const antigravityConfig = JSON.parse(await fs.readFile(autoAntigravityConfigPath, "utf8"));
    assert.equal(antigravityConfig.mcpServers?.pact?.serverUrl, `${serverUrl}/mcp`);

    const commandLog = await fs.readFile(fixtureAgentCommandLog, "utf8");
    assert.match(commandLog, new RegExp(`codex\\|mcp add\\|pact\\|--url\\|${serverUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/mcp\\|--bearer-token-env-var\\|${autoTokenEnv}`));
    assert.match(commandLog, /claude\|mcp add-json\|--scope\|user\|pact/);
    assert.match(commandLog, /openclaw\|mcp set\|pact/);
    assert.match(commandLog, /openclaw\|mcp show\|pact/);
    assert.equal(commandLog.includes(token), false, "fixture agent command log must not persist grant token values");
  });

  // ── SECTION 6: Verify installed config works ──
  console.log("\n[6] Verify installed config");
  await testAsync("installed token calls MCP tools/list", async () => {
    const config = JSON.parse(await fs.readFile(opencodeConfigPath, "utf8"));
    const installedToken = config.mcp?.pact?.headers?.["X-Pact-Api-Key"];
    assert.ok(installedToken);
    const t = await fetchJson(`${serverUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pact-Api-Key": installedToken },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    });
    assert.equal(t.status, 200);
    assert.ok(t.payload.result?.tools?.length > 0);
  });

  await testAsync("installed token calls MCP initialize", async () => {
    const config = JSON.parse(await fs.readFile(opencodeConfigPath, "utf8"));
    const installedToken = config.mcp?.pact?.headers?.["X-Pact-Api-Key"];
    const t = await fetchJson(`${serverUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pact-Api-Key": installedToken },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "opencode", version: "1" } }
      })
    });
    assert.equal(t.status, 200);
    assert.equal(t.payload.result.serverInfo.name, "Pact");
    assert.equal(t.payload.result.capabilities.tools.listChanged, true);
    assert.equal(t.payload.result._meta?.sharedHub?.sharedspace?.outlet, "pact.sharedspace");
    assert.deepEqual(t.payload.result._meta?.priorityTargets, ["claude-code", "codex", "openclaw"]);
    assert.deepEqual(t.payload.result._meta?.supportedTargets?.map((target) => target.target), DECLARED_AGENT_TARGETS);
  });

  await testAsync("doctor without token returns executable auth repair command", async () => {
    const result = await spawnConnector([
      "doctor",
      "--url", serverUrl,
      "--discovery-file", tempRegistryPath,
      "--token-env", missingDoctorTokenEnv,
      "--json"
    ]);
    if (result.code !== 0) {
      console.log(`\n      stdout: ${result.stdout.slice(0, 1200)}`);
      console.log(`      stderr: ${result.stderr.slice(0, 400)}`);
    }
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.checks?.toolsList?.skipped, true);
    assert.equal(payload.checks?.initialize?.sharedHubOk, true);
    assert.equal(payload.checks?.initialize?.sharedHub?.sharedspace?.outlet, "pact.sharedspace");
    assert.deepEqual(payload.checks?.initialize?.priorityTargets, ["claude-code", "codex", "openclaw"]);
    assert.deepEqual(payload.checks?.initialize?.supportedTargets, DECLARED_AGENT_TARGETS);
    assert.deepEqual(payload.supportedTargets, DECLARED_AGENT_TARGETS);
    assert.equal(payload.sharedHub?.sharedspace?.exchangeReceipt?.schemaVersion, "pact.mcp.sharedspace-exchange.v1");
    const expectedDoctorCommand = `pact-mcp doctor --url '${serverUrl}' --token-env '${missingDoctorTokenEnv}' --token-stdin --json`;
    assert.equal(payload.nextCommand, expectedDoctorCommand);
    assert.ok(payload.repairCommands?.includes(expectedDoctorCommand));
  });

  await testAsync("doctor human output redacts local registry path", async () => {
    const result = await spawnConnector([
      "doctor",
      "--url", serverUrl,
      "--discovery-file", tempRegistryPath,
      "--token-env", missingDoctorTokenEnv
    ]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Local registry: <local-path>\/pact-servers\.json/);
    assert.equal(result.stdout.includes(tempRegistryPath), false, "doctor human output must not expose the registry path");
    assert.equal(result.stdout.includes(path.dirname(tempRegistryPath)), false, "doctor human output must not expose the registry directory");
  });

  await testAsync("doctor with token verifies installed target without leaking token", async () => {
    const config = JSON.parse(await fs.readFile(opencodeConfigPath, "utf8"));
    const installedToken = config.mcp?.pact?.headers?.["X-Pact-Api-Key"];
    const result = await spawnConnector([
      "doctor",
      "--url", serverUrl,
      "--token", installedToken,
      "--discovery-file", tempRegistryPath,
      "--json"
    ]);
    if (result.code !== 0) {
      console.log(`\n      stdout: ${result.stdout.slice(0, 1200)}`);
      console.log(`      stderr: ${result.stderr.slice(0, 400)}`);
    }
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.checks?.toolsList?.ok, true);
    assert.equal(payload.checks?.toolsList?.sharedHubOk, true);
    assert.deepEqual(payload.checks?.toolsList?.priorityTargets, ["claude-code", "codex", "openclaw"]);
    assert.deepEqual(payload.checks?.toolsList?.supportedTargets, DECLARED_AGENT_TARGETS);
    assert.equal(payload.checks?.systemHealth?.ok, true);
    assert.deepEqual(payload.repairCommands, []);
    assert.equal(result.stdout.includes(installedToken), false, "doctor output must not expose token values");
  });

  await testAsync("doctor with invalid token returns executable reinstall command", async () => {
    const result = await spawnConnector([
      "doctor",
      "--url", serverUrl,
      "--token", "invalid-token-for-doctor",
      "--discovery-file", tempRegistryPath,
      "--json"
    ]);
    assert.equal(result.code, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.checks?.toolsList?.ok, false);
    assert.equal(payload.checks?.systemHealth?.ok, false);
    assert.equal(payload.nextCommand, `pact-mcp install --target auto --url '${serverUrl}' --json`);
    assert.ok(payload.repairCommands?.includes(`pact-mcp doctor --url '${serverUrl}' --token-stdin --json`));
  });

  await testAsync("unauthenticated tools/list is rejected", async () => {
    const t = await fetchJson(`${serverUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    });
    assert.equal(t.status, 401);
    assert.equal(t.payload.error.data.code, "missing_token");
  });

  // ── SECTION 7: End-to-end CLI uninstall ──
  console.log("\n[7] End-to-end CLI uninstall --target opencode");
  let cliUninstallPayload = null;
  await testAsync("cli uninstall succeeds", async () => {
    const result = await spawnConnector([
      "uninstall",
      "--target", "opencode",
      "--url", serverUrl,
      "--opencode-config", opencodeConfigPath,
      "--discovery-file", tempRegistryPath,
      "--json"
    ]);
    if (result.code !== 0) {
      console.log(`\n      stdout: ${result.stdout.slice(0, 300)}`);
      console.log(`      stderr: ${result.stderr.slice(0, 300)}`);
    }
    assert.equal(result.code, 0, `exit code ${result.code}`);
    cliUninstallPayload = JSON.parse(result.stdout);
    assert.equal(cliUninstallPayload.serverUninstall?.ok, true);
    assert.ok(cliUninstallPayload.serverUninstall?.updatedCount >= 1);

    const config = JSON.parse(await fs.readFile(opencodeConfigPath, "utf8"));
    assert.equal(config.mcp?.pact, undefined, "pact should be removed after uninstall");
  });
  await testAsync("discovery clients removes opencode after uninstall", async () => {
    const clients = await fetchJson(`${serverUrl}/api/discovery/clients`);
    assert.equal(clients.status, 200);
    assert.equal(
      clients.payload.items?.some((item) => item.sourceGrantId === localGrantId && item.clientLabel === "opencode"),
      false,
      "uninstalled opencode should not remain in the current device list"
    );
  });
  await testAsync("tool grant record remains with uninstall metadata", async () => {
    const grants = await fetchJson(`${serverUrl}/api/tool-management/v1/grants`);
    assert.equal(grants.status, 200);
    const grant = grants.payload.grants?.find((item) => item.id === localGrantId);
    assert.ok(grant, "grant record should remain after uninstall");
    assert.equal(grant.enabled, false);
    assert.ok(grant.metadata?.uninstalledTargets?.includes("opencode"));
    assert.ok(grant.metadata?.uninstalledAt);
  });

  await testAsync("cli remote opencode uninstall removes remote config", async () => {
    if (process.platform === "win32") {
      return;
    }
    const result = await spawnConnector([
      "uninstall",
      "--target", "opencode",
      "--execution-location", "docker",
      "--remote-kind", "docker",
      "--remote-id", "box123",
      "--remote-name", "agentbox",
      "--remote-bin", fixtureDockerPath,
      "--discovery-file", remoteOpenCodeRegistryPath,
      "--json"
    ], 60000, {
      PACT_FIXTURE_REMOTE_HOME: remoteOpenCodeHome,
      PACT_MCP_URL: ""
    });
    if (result.code !== 0) {
      console.log(`\n      stdout: ${result.stdout.slice(0, 300)}`);
      console.log(`      stderr: ${result.stderr.slice(0, 300)}`);
    }
    assert.equal(result.code, 0, `exit code ${result.code}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.uninstalled?.opencode?.status, "not-installed");
    assert.equal(payload.uninstalled?.opencode?.uninstallMode, "opencode-docker-mcp-config");
    const remoteConfig = JSON.parse(await fs.readFile(path.join(remoteOpenCodeHome, ".config", "opencode", "opencode.jsonc"), "utf8"));
    assert.equal(remoteConfig.mcp?.pact, undefined);
  });

  // ── SECTION 8: Scan detection ──
  console.log("\n[8] Scan detection");
  await testAsync("scan --json includes opencode", async () => {
    const result = await spawnConnector(["scan", "--json", "--url", serverUrl, "--no-scan"]);
    const scan = JSON.parse(result.stdout);
    const oc = scan.candidates.find((c) => c.target === "opencode");
    assert.ok(oc, "scan should include opencode");
    assert.equal(oc.label, "OpenCode");
    assert.ok(oc.repairCommand?.includes("pact-mcp install --target opencode"), "scan should include an opencode repair command");
    assert.ok(oc.repairCommand?.includes(`--url '${serverUrl}'`), "scan repair command should preserve server url");
  });

  await testAsync("scan guidance preserves custom token environment", async () => {
    const result = await spawnConnector([
      "scan",
      "--json",
      "--url", serverUrl,
      "--token-env", missingInstallTokenEnv,
      "--no-scan"
    ]);
    const scan = JSON.parse(result.stdout);
    for (const target of PRIORITY_AGENT_TARGETS) {
      const candidate = scan.candidates.find((c) => c.target === target);
      assert.ok(candidate?.repairCommand?.includes(`--url '${serverUrl}'`), `${target} repair command should preserve server url`);
      assert.ok(candidate?.repairCommand?.includes(`--token-env '${missingInstallTokenEnv}'`), `${target} repair command should preserve token env`);
      assert.equal(candidate.doctorCommand, `pact-mcp doctor --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    }
  });

  // ── SECTION 9: Connector self-checks ──
  console.log("\n[9] Connector self-checks");
  await testAsync("--version works", async () => {
    const result = await spawnConnector(["--version"]);
    assert.equal(result.code, 0);
    const v = JSON.parse(result.stdout);
    assert.equal(v.packageName, "pact-mcp-connector");
    assert.ok(v.packageVersion);
  });

  await testAsync("usage (help) includes supported agent targets", async () => {
    const result = await spawnConnector([]);
    assert.match(result.stdout, /--codex-bin/);
    assert.match(result.stdout, /--claude-bin/);
    assert.match(result.stdout, /--gemini-bin/);
    assert.match(result.stdout, /--kilo-bin/);
    assert.match(result.stdout, /--copilot-bin/);
    assert.match(result.stdout, /--openclaw-bin/);
    assert.match(result.stdout, /opencode/);
    assert.match(result.stdout, /claude-code,codex,openclaw/);
    for (const target of DECLARED_AGENT_TARGETS) {
      assert.match(result.stdout, new RegExp(`\\b${target}\\b`));
    }
  });

  await testAsync("supported targets include all declared agents", async () => {
    const result = await spawnConnector(["scan", "--json", "--url", serverUrl, "--no-scan"]);
    const scan = JSON.parse(result.stdout);
    const targets = scan.candidates.map((c) => c.target);
    for (const target of DECLARED_AGENT_TARGETS) {
      assert.ok(targets.includes(target), `targets: ${targets.join(", ")}`);
    }
    for (const target of PRIORITY_AGENT_TARGETS) {
      const candidate = scan.candidates.find((c) => c.target === target);
      assert.ok(candidate?.repairCommand?.includes(`pact-mcp install --target ${target}`), `${target} should include a repair command`);
      assert.equal(candidate.doctorCommand, `pact-mcp doctor --url '${serverUrl}' --json`);
    }
  });

  await testAsync("register output preserves verified server url in follow-up commands", async () => {
    const result = await spawnConnector([
      "register",
      "--url", serverUrl,
      "--token-env", missingInstallTokenEnv,
      "--discovery-file", registerRegistryPath,
      "--no-env",
      "--json"
    ]);
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.localEntry?.command, `pact-mcp discover-local --url '${serverUrl}' --json`);
    assert.equal(payload.clientInstall, `pact-mcp install --target <client> --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.autoInstall, `pact-mcp install --target auto --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.priorityInstall, `pact-mcp install --target claude-code,codex,openclaw --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.clientInstallJsonCommand, payload.clientInstall);
    assert.equal(payload.autoInstallCommand, payload.autoInstall);
    assert.equal(payload.priorityInstallCommand, payload.priorityInstall);
    assert.equal(payload.githubOneLineClientInstallJsonCommand, `${RELEASE_BOOTSTRAP} -- --target <client> --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.githubOneLineAutoInstallCommand, `${RELEASE_BOOTSTRAP} -- --target auto --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.githubOneLinePriorityInstallCommand, `${RELEASE_BOOTSTRAP} -- --target claude-code,codex,openclaw --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.githubOneLineClientInstallJsonCommandZhCN, `${RELEASE_BOOTSTRAP_ZH_CN} -- --target <client> --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.githubOneLineAutoInstallCommandZhCN, `${RELEASE_BOOTSTRAP_ZH_CN} -- --target auto --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.githubOneLinePriorityInstallCommandZhCN, `${RELEASE_BOOTSTRAP_ZH_CN} -- --target claude-code,codex,openclaw --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.oneCommandClientInstallJson, payload.githubOneLineClientInstallJsonCommand);
    assert.equal(payload.oneCommandClientInstallJsonZhCN, payload.githubOneLineClientInstallJsonCommandZhCN);
    assert.equal(payload.oneCommandAutoInstall, payload.githubOneLineAutoInstallCommand);
    assert.equal(payload.oneCommandAutoInstallZhCN, payload.githubOneLineAutoInstallCommandZhCN);
    assert.equal(payload.oneCommandPriorityInstall, payload.githubOneLinePriorityInstallCommand);
    assert.equal(payload.oneCommandPriorityInstallZhCN, payload.githubOneLinePriorityInstallCommandZhCN);
    assert.equal(payload.scanCommand, `pact-mcp scan --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.doctorCommand, `pact-mcp doctor --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.deepEqual(payload.priorityTargets, ["claude-code", "codex", "openclaw"]);
    assert.equal(payload.sharedHub?.canonicalMcpUrl, `${serverUrl}/mcp`);
    assert.equal(payload.sharedHub?.sharedspace?.outlet, "pact.sharedspace");
    assert.equal(payload.sharedHub?.sharedspace?.referencePolicy, "use-public-workspace-ref");
    assert.equal(payload.sharedHub?.sharedspace?.exchangeReceipt?.schemaVersion, "pact.mcp.sharedspace-exchange.v1");
    assert.ok(payload.sharedHub?.sharedspace?.exchangeReceipt?.fields?.includes("referencePolicy"));
    assert.ok(payload.sharedHub?.sharedspace?.coreOperations?.includes("pact.sharedspace.file.write"));
    assert.deepEqual(payload.supportedTargets, DECLARED_AGENT_TARGETS);
    const payloadTargetDetails = new Map(payload.supportedTargetDetails.map((target) => [target.target, target]));
    assert.deepEqual([...payloadTargetDetails.keys()], DECLARED_AGENT_TARGETS);
    assert.equal(payloadTargetDetails.get("openclaw").installMode, "openclaw-release-mcp-cli");
    assert.equal(payloadTargetDetails.get("opencode").priority, true);
    const manifest = JSON.parse(await fs.readFile(registerRegistryPath, "utf8"));
    assert.equal(manifest.servers?.pact?.auth?.tokenEnv, missingInstallTokenEnv);
    assert.equal(manifest.servers?.pact?.connector?.autoInstallCommand, `npx pact-mcp-connector@${payload.packageVersion} install --target auto --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(manifest.servers?.pact?.connector?.priorityInstallCommand, `npx pact-mcp-connector@${payload.packageVersion} install --target claude-code,codex,openclaw --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(manifest.servers?.pact?.connector?.githubOneLineAutoInstallCommandZhCN, payload.githubOneLineAutoInstallCommandZhCN);
    assert.equal(manifest.servers?.pact?.connector?.githubOneLinePriorityInstallCommandZhCN, payload.githubOneLinePriorityInstallCommandZhCN);
    assert.equal(manifest.servers?.pact?.connector?.oneCommandAutoInstallZhCN, payload.githubOneLineAutoInstallCommandZhCN);
    assert.equal(manifest.servers?.pact?.upgrade?.oneCommandPriorityAgentReinstallZhCN, payload.githubOneLinePriorityInstallCommandZhCN);
    assert.deepEqual(manifest.servers?.pact?.connector?.priorityTargets, ["claude-code", "codex", "openclaw"]);
    assert.deepEqual(manifest.servers?.pact?.connector?.supportedTargets, DECLARED_AGENT_TARGETS);
    assert.deepEqual(manifest.servers?.pact?.connector?.supportedTargetDetails, payload.supportedTargetDetails);
    assert.equal(manifest.servers?.pact?.sharedHub?.sharedspace?.exchangeReceipt?.schemaVersion, "pact.mcp.sharedspace-exchange.v1");
    assert.ok(manifest.servers?.pact?.sharedHub?.sharedspace?.exchangeReceipt?.fields?.includes("referencePolicy"));
    assert.ok(manifest.servers?.pact?.sharedHub?.sharedspace?.coreOperations?.includes("pact.sharedspace.file.write"));
    assert.equal(manifest.servers?.pact?.connector?.installCommand, `npx pact-mcp-connector@${payload.packageVersion} install --target <client> --url '${serverUrl}' --token-env '${missingInstallTokenEnv}'`);
    assert.equal(manifest.servers?.pact?.connector?.scanCommand, `npx pact-mcp-connector@${payload.packageVersion} scan --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    const refresh = await spawnConnector([
      "register",
      "--url", serverUrl,
      "--discovery-file", registerRegistryPath,
      "--no-env",
      "--json"
    ]);
    assert.equal(refresh.code, 0);
    const refreshPayload = JSON.parse(refresh.stdout);
    assert.equal(refreshPayload.clientInstall, `pact-mcp install --target <client> --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(refreshPayload.autoInstall, `pact-mcp install --target auto --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(refreshPayload.priorityInstall, `pact-mcp install --target claude-code,codex,openclaw --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(refreshPayload.githubOneLineAutoInstallCommand, `${RELEASE_BOOTSTRAP} -- --target auto --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(refreshPayload.oneCommandAutoInstall, refreshPayload.githubOneLineAutoInstallCommand);
    assert.deepEqual(refreshPayload.priorityTargets, ["claude-code", "codex", "openclaw"]);
    assert.deepEqual(refreshPayload.supportedTargets, DECLARED_AGENT_TARGETS);
    const refreshedManifest = JSON.parse(await fs.readFile(registerRegistryPath, "utf8"));
    assert.equal(refreshedManifest.servers?.pact?.auth?.tokenEnv, missingInstallTokenEnv);
  });

  // ── SECTION 10: Machine-readable install failures ──
  console.log("\n[10] Machine-readable install failures");
  await testAsync("unsupported target returns next executable command", async () => {
    const result = await spawnConnector([
      "install",
      "--target", "not-a-real-agent",
      "--url", serverUrl,
      "--token", token,
      "--json"
    ]);
    assert.equal(result.code, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.errorCode, "UNSUPPORTED_TARGET");
    assert.equal(payload.nextCommand, `pact-mcp scan --url '${serverUrl}' --json`);
    assert.equal(payload.discoverCommand, `pact-mcp discover-local --url '${serverUrl}' --json`);
    assert.equal(payload.scanCommand, `pact-mcp scan --url '${serverUrl}' --json`);
    assert.equal(payload.doctorCommand, `pact-mcp doctor --url '${serverUrl}' --json`);
    assert.equal(payload.clientInstallJsonCommand, `pact-mcp install --target <client> --url '${serverUrl}' --json`);
    assert.equal(payload.autoInstallCommand, `pact-mcp install --target auto --url '${serverUrl}' --json`);
    assert.equal(payload.priorityInstallCommand, `pact-mcp install --target claude-code,codex,openclaw --url '${serverUrl}' --json`);
    assert.equal(payload.githubOneLineClientInstallJsonCommand, `${RELEASE_BOOTSTRAP} -- --target <client> --url '${serverUrl}' --json`);
    assert.equal(payload.githubOneLineAutoInstallCommand, `${RELEASE_BOOTSTRAP} -- --target auto --url '${serverUrl}' --json`);
    assert.equal(payload.githubOneLinePriorityInstallCommand, `${RELEASE_BOOTSTRAP} -- --target claude-code,codex,openclaw --url '${serverUrl}' --json`);
    assert.equal(payload.githubOneLineClientInstallJsonCommandZhCN, `${RELEASE_BOOTSTRAP_ZH_CN} -- --target <client> --url '${serverUrl}' --json`);
    assert.equal(payload.githubOneLineAutoInstallCommandZhCN, `${RELEASE_BOOTSTRAP_ZH_CN} -- --target auto --url '${serverUrl}' --json`);
    assert.equal(payload.githubOneLinePriorityInstallCommandZhCN, `${RELEASE_BOOTSTRAP_ZH_CN} -- --target claude-code,codex,openclaw --url '${serverUrl}' --json`);
    assert.equal(payload.oneCommandAutoInstall, payload.githubOneLineAutoInstallCommand);
    assert.equal(payload.oneCommandAutoInstallZhCN, payload.githubOneLineAutoInstallCommandZhCN);
    assert.ok(payload.repairCommands?.includes(`pact-mcp scan --url '${serverUrl}' --json`));
    assert.ok(payload.repairCommands?.includes(`pact-mcp install --target auto --url '${serverUrl}' --json`));
    assert.deepEqual(payload.supportedTargets, DECLARED_AGENT_TARGETS);
    const targetDetails = new Map(payload.supportedTargetDetails.map((target) => [target.target, target]));
    assert.deepEqual([...targetDetails.keys()], DECLARED_AGENT_TARGETS);
    assert.equal(targetDetails.get("claude-code").label, "Claude Code");
    assert.equal(targetDetails.get("openclaw").priority, true);
    for (const target of PRIORITY_AGENT_TARGETS) {
      assert.ok(payload.supportedTargets?.includes(target), `${target} should be listed as supported`);
    }
  });

  await testAsync("unsupported target human output prints install shortcuts", async () => {
    const result = await spawnConnector([
      "install",
      "--target", "not-a-real-agent",
      "--url", serverUrl,
      "--token", token
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /Install shortcuts:/);
    assert.equal(
      result.stdout.includes(`One-command priority install: ${RELEASE_BOOTSTRAP} -- --target claude-code,codex,openclaw --url '${serverUrl}' --json`),
      true
    );
    assert.equal(
      result.stdout.includes(`One-command auto install: ${RELEASE_BOOTSTRAP} -- --target auto --url '${serverUrl}' --json`),
      true
    );
    assert.equal(
      result.stdout.includes(`Priority install: pact-mcp install --target claude-code,codex,openclaw --url '${serverUrl}' --json`),
      true
    );
    assert.equal(
      result.stdout.includes(`Auto install: pact-mcp install --target auto --url '${serverUrl}' --json`),
      true
    );
    assert.match(result.stdout, /Repair commands:/);
  });

  await testAsync("missing token guidance preserves explicit server url", async () => {
    const result = await spawnConnector([
      "install",
      "--target", "codex",
      "--url", serverUrl,
      "--token-env", missingInstallTokenEnv,
      "--no-auto-token",
      "--json"
    ]);
    assert.equal(result.code, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.errorCode, "MISSING_TOKEN");
    assert.ok(payload.nextCommand?.includes("--token-stdin"));
    assert.ok(payload.nextCommand?.includes(`--url '${serverUrl}'`));
    assert.ok(payload.nextCommand?.includes(`--token-env '${missingInstallTokenEnv}'`));
    assert.ok(payload.repairCommands?.every((command) => command.includes(`--url '${serverUrl}'`)));
    assert.ok(payload.repairCommands?.every((command) => command.includes(missingInstallTokenEnv)));
    assert.deepEqual(payload.priorityTargets, ["claude-code", "codex", "openclaw"]);
    assert.deepEqual(payload.supportedTargets, DECLARED_AGENT_TARGETS);
    assert.equal(payload.scanCommand, `pact-mcp scan --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.doctorCommand, `pact-mcp doctor --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.clientInstallJsonCommand, `pact-mcp install --target <client> --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.autoInstallCommand, `pact-mcp install --target auto --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.priorityInstallCommand, `pact-mcp install --target claude-code,codex,openclaw --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.githubOneLineClientInstallJsonCommand, `${RELEASE_BOOTSTRAP} -- --target <client> --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.githubOneLineAutoInstallCommand, `${RELEASE_BOOTSTRAP} -- --target auto --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.githubOneLinePriorityInstallCommand, `${RELEASE_BOOTSTRAP} -- --target claude-code,codex,openclaw --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.githubOneLineClientInstallJsonCommandZhCN, `${RELEASE_BOOTSTRAP_ZH_CN} -- --target <client> --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.githubOneLineAutoInstallCommandZhCN, `${RELEASE_BOOTSTRAP_ZH_CN} -- --target auto --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.githubOneLinePriorityInstallCommandZhCN, `${RELEASE_BOOTSTRAP_ZH_CN} -- --target claude-code,codex,openclaw --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.oneCommandPriorityInstall, payload.githubOneLinePriorityInstallCommand);
    assert.equal(payload.oneCommandPriorityInstallZhCN, payload.githubOneLinePriorityInstallCommandZhCN);
    assert.equal(payload.supportedTargetDetails?.find((target) => target.target === "openclaw")?.priority, true);
    assert.equal(result.stdout.includes(token), false, "missing-token guidance must not expose grant tokens");
  });

  await testAsync("missing hub guidance prefers auto install repair command", async () => {
    const unavailableUrl = "http://127.0.0.1:9";
    const result = await spawnConnector([
      "install",
      "--target", "codex",
      "--url", unavailableUrl,
      "--json"
    ]);
    assert.equal(result.code, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.errorCode, "PACT_HUB_NOT_DISCOVERED");
    assert.equal(payload.nextCommand, `pact-mcp discover-local --url '${unavailableUrl}' --json`);
    assert.ok(payload.repairCommands?.includes(`pact-mcp install --target auto --url '${unavailableUrl}' --json`));
    assert.deepEqual(payload.priorityTargets, ["claude-code", "codex", "openclaw"]);
    assert.deepEqual(payload.supportedTargets, DECLARED_AGENT_TARGETS);
    assert.equal(payload.discoverCommand, `pact-mcp discover-local --url '${unavailableUrl}' --json`);
    assert.equal(payload.clientInstallJsonCommand, `pact-mcp install --target <client> --url '${unavailableUrl}' --json`);
    assert.equal(payload.autoInstallCommand, `pact-mcp install --target auto --url '${unavailableUrl}' --json`);
    assert.equal(payload.priorityInstallCommand, `pact-mcp install --target claude-code,codex,openclaw --url '${unavailableUrl}' --json`);
    assert.equal(payload.githubOneLineAutoInstallCommand, `${RELEASE_BOOTSTRAP} -- --target auto --url '${unavailableUrl}' --json`);
    assert.equal(payload.oneCommandAutoInstall, payload.githubOneLineAutoInstallCommand);
    assert.equal(payload.supportedTargetDetails?.find((target) => target.target === "claude-code")?.label, "Claude Code");
  });

  await testAsync("auto install with no detected clients returns machine-readable repair commands", async () => {
    await fs.mkdir(noDetectHome, { recursive: true });
    const result = await spawnConnector([
      "install",
      "--target", "auto",
      "--url", serverUrl,
      "--token", token,
      "--token-env", missingInstallTokenEnv,
      "--discovery-file", noDetectRegistryPath,
      "--no-scan",
      "--json"
    ], 30000, {
      HOME: noDetectHome,
      PATH: ["/usr/bin", "/bin"].join(path.delimiter)
    });
    assert.equal(result.code, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.errorCode, "NO_SUPPORTED_MCP_CLIENTS_DETECTED");
    assert.equal(payload.nextCommand, `pact-mcp scan --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.ok(payload.repairCommands?.some((command) => command.includes("pact-mcp install --target claude-code --claude-bin claude")));
    assert.ok(payload.repairCommands?.every((command) => command.includes(`--url '${serverUrl}'`)));
    assert.ok(payload.repairCommands?.every((command) => command.includes(`--token-env '${missingInstallTokenEnv}'`)));
    assert.deepEqual(payload.priorityTargets, ["claude-code", "codex", "openclaw"]);
    assert.deepEqual(payload.supportedTargets, DECLARED_AGENT_TARGETS);
    assert.equal(payload.clientInstallJsonCommand, `pact-mcp install --target <client> --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.scanCommand, `pact-mcp scan --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.autoInstallCommand, `pact-mcp install --target auto --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.priorityInstallCommand, `pact-mcp install --target claude-code,codex,openclaw --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`);
    assert.equal(payload.supportedTargetDetails?.find((target) => target.target === "claude-code")?.installMode, "claude-code-release-mcp-cli");
    assert.equal(payload.candidates?.some((candidate) => candidate.target === "codex"), true);
    assert.equal(payload.candidates?.some((candidate) => candidate.target === "claude-code"), true);
    assert.equal(payload.candidates?.some((candidate) => candidate.target === "openclaw"), true);
    for (const target of PRIORITY_AGENT_TARGETS) {
      const candidate = payload.candidates?.find((item) => item.target === target);
      assert.ok(candidate?.repairCommand?.includes(`pact-mcp install --target ${target}`), `${target} should provide a repair command`);
    }
  });

  await testAsync("auto install no detected clients prints human install shortcuts", async () => {
    await fs.mkdir(noDetectHome, { recursive: true });
    const result = await spawnConnector([
      "install",
      "--target", "auto",
      "--url", serverUrl,
      "--token", token,
      "--token-env", missingInstallTokenEnv,
      "--discovery-file", noDetectRegistryPath,
      "--no-scan"
    ], 30000, {
      HOME: noDetectHome,
      PATH: ["/usr/bin", "/bin"].join(path.delimiter)
    });
    assert.equal(result.code, 1);
    assert.match(result.stdout, /Install shortcuts:/);
    assert.equal(
      result.stdout.includes(`One-command priority install: ${RELEASE_BOOTSTRAP} -- --target claude-code,codex,openclaw --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`),
      true
    );
    assert.equal(
      result.stdout.includes(`One-command auto install: ${RELEASE_BOOTSTRAP} -- --target auto --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`),
      true
    );
    assert.equal(
      result.stdout.includes(`Priority install: pact-mcp install --target claude-code,codex,openclaw --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`),
      true
    );
    assert.equal(
      result.stdout.includes(`Auto install: pact-mcp install --target auto --url '${serverUrl}' --token-env '${missingInstallTokenEnv}' --json`),
      true
    );
    assert.match(result.stdout, /Repair commands:/);
    assert.equal(result.stdout.includes("pact-mcp install --target claude-code --claude-bin claude"), true);
  });

} catch (error) {
  console.error(`\nUNEXPECTED ERROR: ${error.message}`);
  failed++;
} finally {
  if (server?.close) {
    await server.close();
  }
  await unsetLaunchctlEnv(autoTokenEnv);
  await unsetLaunchctlEnv(missingDoctorTokenEnv);
  await fs.rm(userDataPath, { recursive: true, force: true }).catch(() => {});
  await fs.rm(opencodeConfigDir, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
process.exit(failed > 0 ? 1 : 0);
