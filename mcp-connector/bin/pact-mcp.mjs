#!/usr/bin/env node
import { execFile, spawn, execSync } from "node:child_process";
import { createPublicKey, randomBytes, verify } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageJson = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));

const isChinese = (() => {
  const lang = String(process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || "").toLowerCase();
  if (lang.includes("zh")) {
    return true;
  }
  try {
    if (os.platform() === "darwin") {
      const output = execSync("defaults read -g AppleLanguages 2>/dev/null", { encoding: "utf8" });
      if (output && /zh-/i.test(output)) {
        return true;
      }
    } else if (os.platform() === "win32") {
      const output = execSync("powershell -NoProfile -Command \"[System.Globalization.CultureInfo]::CurrentCulture.Name\" 2>$null", { encoding: "utf8" });
      if (output && /zh-/i.test(output)) {
        return true;
      }
    }
  } catch (error) {
    // Silently ignore command failures and fall back
  }
  return false;
})();

function msg(en, zh) {
  return isChinese ? zh : en;
}

const DEFAULT_TOKEN_ENV = "PACT_MCP_TOKEN";
const DEFAULT_CODEX_BIN = "codex";
const DEFAULT_CLAUDE_BIN = "claude";
const DEFAULT_KILO_BIN = "kilo";
const DEFAULT_COPILOT_BIN = "copilot";
const DEFAULT_OPENCODE_BIN = "opencode";
const DEFAULT_ORB_BIN = "orb";
const DEFAULT_DOCKER_BIN = "docker";
const DEFAULT_PODMAN_BIN = "podman";
const DEFAULT_NERDCTL_BIN = "nerdctl";
const DEFAULT_WSL_BIN = "wsl.exe";
const DEFAULT_LIMA_BIN = "limactl";
const DEFAULT_COLIMA_BIN = "colima";
const DEFAULT_MULTIPASS_BIN = "multipass";
const DEFAULT_LXC_BIN = "lxc";
const DEFAULT_INCUS_BIN = "incus";
const DEFAULT_VAGRANT_BIN = "vagrant";
const DEFAULT_PARALLELS_BIN = "prlctl";
const CLAW_COMPATIBLE_COMMANDS = ["openclaw", "ironclaw", "zeroclaw"];
const HERMES_COMMAND_NAMES = ["hermes"];
const AGENT_CLI_TARGETS = [
  {
    target: "codex",
    label: "Codex",
    binOption: "codex-bin",
    commandNames: ["codex"]
  },
  {
    target: "claude-code",
    label: "Claude Code",
    binOption: "claude-bin",
    commandNames: ["claude"]
  },
  {
    target: "copilot",
    label: "Copilot",
    binOption: "copilot-bin",
    commandNames: ["copilot"]
  },
  {
    target: "kilo-code",
    label: "Kilo Code",
    binOption: "kilo-bin",
    commandNames: ["kilo"]
  },
  {
    target: "opencode",
    label: "OpenCode",
    binOption: "opencode-bin",
    commandNames: ["opencode"]
  }
];
const ORB_AGENT_CLI_TARGETS = AGENT_CLI_TARGETS;
const APP_DISCOVERY_NAME_HINTS = [
  "pact",
  "antigravity",
  "aider",
  "anthropic",
  "chatgpt",
  "claude",
  "cline",
  "codex",
  "codeium",
  "continue",
  "copilot",
  "cursor",
  "devin",
  "goose",
  "hermes",
  "kilo",
  "openclaw",
  "opencode",
  "qodo",
  "roo",
  "tabnine",
  "trae",
  "zeroclaw"
];
const APP_DISCOVERY_WORD_HINTS = ["agent", "bot", "claw", "code"];
const PLUGIN_NAME = "pact-mcp";
const MARKETPLACE_NAME = "pact-local";
const MCP_SERVER_NAME = "pact";
const MCP_STABLE_TOOL_NAME = "pact.discovery";
const MCP_INTERFACE_VERSION = "v0.0.1:mcp:interface-1";
const BOOTSTRAP_CURL_FLAGS = "-fL --retry 3 --connect-timeout 20 -sS";
const BOOTSTRAP_INSTALL_SCRIPT = "pact-mcp-install.sh";
const BOOTSTRAP_INSTALL_SCRIPT_ZH_CN = "pact-mcp-install.zh-CN.sh";
const HTTP_TIMEOUT_MS = 300000;
const SUPPORTED_TARGETS = [
  "openclaw",
  "claude-code",
  "codex",
  "antigravity",
  "opencode",
  "copilot",
  "kilo-code",
  "cursor",
  "hermes"
];
const PRIORITY_INSTALL_TARGETS = Object.freeze(["claude-code", "codex", "openclaw"]);
const PRIORITY_INSTALL_TARGET = PRIORITY_INSTALL_TARGETS.join(",");
const PACT_MCP_URL_ENV = "PACT_MCP_URL";
const PACT_MCP_DISCOVERY_URL_ENV = "PACT_MCP_DISCOVERY_URL";
const PACT_MCP_DISCOVERY_FILE_ENV = "PACT_MCP_DISCOVERY_FILE";
const DEFAULT_DISCOVERY_REGISTRY = path.join(os.homedir(), ".pact", "mcp", "servers.json");
const DEFAULT_SCAN_PORTS = [7228, 7229, 7230, 7231, 7232, 7233, 7234, 7235, 7236, 7237];
const TARGET_ALIASES = new Map([
  ["claude", "claude-code"],
  ["claude_code", "claude-code"],
  ["claudecode", "claude-code"],
  ["anthropic-claude-code", "claude-code"],
  ["kilo", "kilo-code"],
  ["kilocode", "kilo-code"],
  ["kilo_code", "kilo-code"],
  ["github-copilot", "copilot"],
  ["hermes-agent", "hermes"],
  ["cursor-agent", "cursor"],
  ["open-code", "opencode"]
]);
const TARGET_LABELS = {
  openclaw: "OpenClaw",
  "claude-code": "Claude Code",
  codex: "Codex",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  copilot: "Copilot",
  "kilo-code": "Kilo Code",
  cursor: "Cursor",
  hermes: "Hermes Agent"
};
const TARGET_INSTALL_MODES = {
  openclaw: "openclaw-release-mcp-cli",
  "claude-code": "claude-code-release-mcp-cli",
  codex: "codex-release-plugin-and-mcp-cli",
  antigravity: "antigravity-release-mcp-config",
  opencode: "opencode-release-mcp-config",
  copilot: "copilot-release-mcp-cli",
  "kilo-code": "kilo-release-global-kilo-json",
  cursor: "cursor-release-mcp-config",
  hermes: "hermes-remote-mcp-cli"
};
const TARGET_LOCATIONS = Object.freeze({
  openclaw: ["local", "orbstack", "remote-linux"],
  "claude-code": ["local", "orbstack", "remote-linux"],
  codex: ["local", "orbstack", "remote-linux"],
  antigravity: ["local"],
  opencode: ["local", "orbstack", "remote-linux"],
  copilot: ["local", "orbstack", "remote-linux"],
  "kilo-code": ["local", "orbstack", "remote-linux"],
  cursor: ["local"],
  hermes: ["orbstack", "remote-linux"]
});
const SCAN_COMMAND_TIMEOUT_MS = 3000;
const REMOTE_SCAN_COMMAND_TIMEOUT_MS = 8000;
const INSTALL_COMMAND_TIMEOUT_MS = positiveIntegerEnv("PACT_MCP_INSTALL_COMMAND_TIMEOUT_MS", 120000);
const PACKAGE_MANAGER_DISCOVERY_ENV = Object.freeze({
  HOMEBREW_NO_AUTO_UPDATE: "1",
  HOMEBREW_NO_ANALYTICS: "1",
  HOMEBREW_NO_ENV_HINTS: "1"
});
const HOST_PLATFORM = Object.freeze({
  MACOS: "darwin",
  LINUX: "linux",
  WINDOWS: "win32"
});
const PACKAGE_SOURCE_KIND = Object.freeze({
  STATIC_DIRS: "static-dirs",
  COMMAND_DIR: "command-dir",
  VERSIONED_DIRS: "versioned-dirs",
  COMMAND_PATHS: "command-paths",
  COMMAND_PREFIX_DIRS: "command-prefix-dirs"
});
const SHAREDSPACE_CORE_OPERATIONS = Object.freeze([
  "pact.agentWorkspace.create",
  "pact.sharedspace.localDir.connect",
  "pact.sharedspace.localDir.list",
  "pact.sharedspace.item.list",
  "pact.sharedspace.file.read",
  "pact.sharedspace.file.write",
  "pact.sharedspace.item.delete",
  "pact.sharedspace.sync.plan",
  "pact.sharedspace.sync.apply",
  "pact.sharedspace.drive.connect",
  "pact.sharedspace.drive.status",
  "pact.sharedspace.drive.item.list",
  "pact.sharedspace.drive.file.download",
  "pact.sharedspace.drive.file.upload",
  "pact.sharedspace.drive.sync.plan",
  "pact.sharedspace.drive.sync.apply",
  "pact.sharedspace.drive.permission.list"
]);

function supportedTargetDetails() {
  return SUPPORTED_TARGETS.map((target) => ({
    target,
    label: TARGET_LABELS[target] || target,
    priority: PRIORITY_INSTALL_TARGETS.includes(target) || target === "opencode",
    installMode: TARGET_INSTALL_MODES[target] || "supported",
    locations: [...(TARGET_LOCATIONS[target] || ["local"])]
  }));
}

function sharedspaceExchangeReceiptContract() {
  return {
    schemaVersion: "v0.0.1:mcp:sharedspace-exchange-1",
    locations: [
      "structuredContent.exchange",
      "notifications/pact/operation_reply.params.exchange"
    ],
    actions: [
      "workspace-created",
      "file-written",
      "file-read",
      "items-listed",
      "item-deleted",
      "local-dir-connected",
      "local-dirs-listed",
      "sync-planned",
      "sync-applied",
      "drive-connected",
      "drive-status",
      "drive-items-listed",
      "drive-file-downloaded",
      "drive-file-uploaded",
      "drive-sync-planned",
      "drive-sync-applied",
      "drive-permissions-listed",
      "operation"
    ],
    fields: [
      "action",
      "outlet",
      "referencePolicy",
      "workspaceRef",
      "driveRef",
      "provider",
      "path",
      "paths",
      "itemCount",
      "transferReceiptId",
      "accessReceiptId",
      "checkpointId",
      "syncReceiptId",
      "contractVerified",
      "localAdapterVerified",
      "nextOperations"
    ]
  };
}

function sharedHubContract({ mcpUrl = "", vmMcpUrl = "" } = {}) {
  return {
    canonicalMcpUrl: mcpUrl,
    vmMcpUrl,
    clientPolicy: "discover-shared-hub-then-opt-in",
    defaultClientMutation: "none",
    directHttp: true,
    sharedspace: {
      outlet: "pact.sharedspace",
      referencePolicy: "use-public-workspace-ref",
      exchangeReceipt: sharedspaceExchangeReceiptContract(),
      coreOperations: [...SHAREDSPACE_CORE_OPERATIONS]
    }
  };
}

const GENERIC_REMOTE_CONTEXT_KINDS = [
  "docker",
  "podman",
  "nerdctl",
  "wsl",
  "lima",
  "colima",
  "multipass",
  "lxc",
  "incus",
  "vagrant",
  "parallels"
];

function positiveIntegerEnv(name, fallback) {
  const value = Number.parseInt(String(process.env[name] || ""), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function usage() {
  return [
    "Usage:",
    "  pact-mcp register",
    "  pact-mcp install",
    "  pact-mcp install --target auto",
    "  pact-mcp install --target claude-code,codex,openclaw",
    "  pact-mcp uninstall",
    "  pact-mcp uninstall --target claude-code,codex,openclaw",
    "  pact-mcp scan --json",
    "  pact-mcp discover-local --json",
    "  pact-mcp doctor",
    "  pact-mcp discover",
    "  pact-mcp server-config --set --url http://host:port --name local",
    "  pact-mcp server-config --switch local",
    "  pact-mcp server-config --refresh",
    "  pact-mcp server-config --reset",
    "",
    "Options:",
    "  --target LIST                 Comma-separated targets for non-interactive install. Use auto for detected clients.",
    `                                Supported targets: ${SUPPORTED_TARGETS.join(", ")}.`,
    "  --url URL                     Explicit Pact base URL. Still requires signed MCP handshake.",
    "  --scan-ports LIST            Local ports to scan when --url is omitted. Default: 7228-7237.",
    "  --token TOKEN                 Pact MCP token. Prefer --token-stdin or --token-env.",
    "  --token-stdin                 Read token from stdin.",
    "  --token-env NAME              Token environment variable. Default: PACT_MCP_TOKEN.",
    "  --no-auto-token               Require an explicit token instead of requesting a local grant.",
    "  --no-verify                   Skip post-install MCP HTTP verification.",
    "  --json                        Emit JSON.",
    "  --pretty                      Pretty-print JSON output.",
    "  --no-env                      Do not publish launchctl environment variables during register.",
    "  --discovery-file PATH         Registry file used by register/discover-local. Default: ~/.pact/mcp/servers.json.",
    "  --auto-update                 Enable automatic push updates when installing (non-interactive mode).",
    "  --codex-bin COMMAND           Codex CLI command or explicit path. Default: codex.",
    "  --claude-bin COMMAND          Claude Code CLI command or explicit path. Default: claude.",
    "  --kilo-bin COMMAND            Kilo Code CLI command or explicit path. Default: kilo.",
    "  --copilot-bin COMMAND         Copilot CLI command or explicit path. Default: copilot.",
    "  --opencode-bin COMMAND         OpenCode CLI command or explicit path. Default: opencode.",
    "  --cursor-config PATH           Cursor MCP settings path.",
    "  --orb-bin COMMAND             OrbStack CLI command or explicit path. Default: orb.",
    "  --docker-bin COMMAND          Docker CLI command or explicit path. Default: docker.",
    "  --podman-bin COMMAND          Podman CLI command or explicit path. Default: podman.",
    "  --nerdctl-bin COMMAND         nerdctl CLI command or explicit path. Default: nerdctl.",
    "  --wsl-bin COMMAND             WSL CLI command or explicit path. Default: wsl.exe.",
    "  --lima-bin COMMAND            Lima CLI command or explicit path. Default: limactl.",
    "  --colima-bin COMMAND          Colima CLI command or explicit path. Default: colima.",
    "  --multipass-bin COMMAND       Multipass CLI command or explicit path. Default: multipass.",
    "  --lxc-bin COMMAND             LXD/LXC CLI command or explicit path. Default: lxc.",
    "  --incus-bin COMMAND           Incus CLI command or explicit path. Default: incus.",
    "  --vagrant-bin COMMAND         Vagrant CLI command or explicit path. Default: vagrant.",
    "  --parallels-bin COMMAND       Parallels prlctl command or explicit path. Default: prlctl.",
    "  --vm NAME                     Shared OrbStack VM name for OpenClaw/Hermes.",
    "  --vm-user USER                Shared OrbStack VM user for OpenClaw/Hermes.",
    "  --openclaw-vm NAME            Explicit OrbStack VM for non-interactive OpenClaw install.",
    "  --openclaw-user USER          Explicit OrbStack VM user for non-interactive OpenClaw install.",
    "  --openclaw-bin PATH           Explicit OpenClaw-like CLI path. No default path is assumed.",
    "  --hermes-vm NAME              Explicit OrbStack VM for non-interactive Hermes install.",
    "  --hermes-user USER            Explicit OrbStack VM user for non-interactive Hermes install.",
    "  --hermes-bin PATH             Explicit Hermes CLI path. No default path is assumed.",
    "",
    "Interactive install:",
    "  When --target is omitted in a TTY, install opens a multi-select menu.",
    "  Use Up/Down or j/k to move, Space to toggle, a to toggle detected clients, Enter to install.",
    "",
    "Interactive uninstall:",
    "  When --target is omitted in a TTY, uninstall scans the same clients and opens a multi-select removal menu."
  ].join("\n");
}

function parseArgs(argv) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      positionals.push(item);
      continue;
    }
    const keyValue = item.slice(2);
    const equalIndex = keyValue.indexOf("=");
    const key = equalIndex >= 0 ? keyValue.slice(0, equalIndex) : keyValue;
    const inlineValue = equalIndex >= 0 ? keyValue.slice(equalIndex + 1) : null;
    if (
      key === "help" ||
      key === "json" ||
      key === "pretty" ||
      key === "token-stdin" ||
      key === "no-verify" ||
      key === "no-auto-token" ||
      key === "no-scan" ||
      key === "set" ||
      key === "refresh" ||
      key === "reset" ||
      key === "list"
    ) {
      options[key] = true;
      continue;
    }
    const next = argv[index + 1];
    const value = inlineValue !== null ? inlineValue : !next || next.startsWith("--") ? true : next;
    if (inlineValue === null && value !== true) {
      index += 1;
    }
    options[key] = value;
  }
  return {
    command: positionals[0] || "",
    options
  };
}

function option(options, name, fallback = "") {
  return options[name] === undefined ? fallback : options[name];
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeTarget(value) {
  const raw = String(value || "").trim().toLowerCase();
  return TARGET_ALIASES.get(raw) || raw;
}

function parseTargets(rawTarget) {
  const values = String(rawTarget || "codex").split(",").map(normalizeTarget).filter(Boolean);
  const deduped = [...new Set(values)];
  for (const target of deduped) {
    if (!SUPPORTED_TARGETS.includes(target)) {
      throw new Error(`Unsupported install target: ${target}`);
    }
  }
  return deduped;
}

function isAutoTargetRequest(rawTarget) {
  const target = normalizeTarget(rawTarget);
  return ["auto", "detected", "all-detected"].includes(target);
}

function targetLabel(target) {
  return TARGET_LABELS[target] || target;
}

function targetInstallMode(target) {
  return TARGET_INSTALL_MODES[target] || "pact-mcp-client-install";
}

function notDetectedTargetDetail(target) {
  if (target === "openclaw") {
    return "OpenClaw-compatible MCP CLI was not detected. Pass --openclaw-bin or run scan in the target VM/context.";
  }
  if (target === "hermes") {
    return "Hermes MCP CLI was not detected in an OrbStack VM or remote Linux context. Pass --vm/--vm-user or run scan where Hermes is installed.";
  }
  if (target === "antigravity") {
    return "Antigravity config path not found yet.";
  }
  if (target === "cursor") {
    return "Cursor MCP config path not found yet. Pass --cursor-config with an explicit path.";
  }
  const descriptor = AGENT_CLI_TARGETS.find((item) => item.target === target);
  if (descriptor) {
    return `${descriptor.commandNames.join("/")} executable was not detected. Pass --${descriptor.binOption} with an explicit command or path.`;
  }
  return `${targetLabel(target)} was not detected.`;
}

function targetBinOption(target) {
  if (target === "openclaw") {
    return "openclaw-bin";
  }
  if (target === "hermes") {
    return "hermes-bin";
  }
  const descriptor = AGENT_CLI_TARGETS.find((item) => item.target === target);
  return descriptor?.binOption || "";
}

function targetDefaultCommand(target) {
  if (target === "claude-code") {
    return "claude";
  }
  if (target === "kilo-code") {
    return "kilo";
  }
  return target || "codex";
}

function shellCommandForInstall({
  target = "codex",
  binOption = "",
  includeUrl = false,
  baseUrl = "http://127.0.0.1:7228",
  includeToken = false,
  tokenEnv = ""
} = {}) {
  const parts = ["pact-mcp", "install", "--target", target];
  if (binOption) {
    parts.push(`--${binOption}`, targetDefaultCommand(target));
  }
  if (includeUrl) {
    parts.push("--url", shellQuote(baseUrl));
  }
  if (tokenEnv && tokenEnv !== DEFAULT_TOKEN_ENV) {
    parts.push("--token-env", shellQuote(tokenEnv));
  }
  if (includeToken) {
    parts.push("--token-stdin");
  }
  parts.push("--json");
  return parts.join(" ");
}

function commandGuidanceBaseUrl(options = {}) {
  return normalizeBaseUrl(option(options, "resolved-url", explicitBaseUrl(options)));
}

function commandGuidanceContext(options = {}) {
  return {
    baseUrl: commandGuidanceBaseUrl(options),
    tokenEnv: String(option(options, "token-env", DEFAULT_TOKEN_ENV))
  };
}

function appendGuidanceContextArgs(parts, { baseUrl = "", tokenEnv = DEFAULT_TOKEN_ENV, includeUrl = false } = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (includeUrl && normalizedBaseUrl) {
    parts.push("--url", shellQuote(normalizedBaseUrl));
  }
  if (tokenEnv && tokenEnv !== DEFAULT_TOKEN_ENV) {
    parts.push("--token-env", shellQuote(tokenEnv));
  }
  return parts;
}

function shellCommandForScan({ includeUrl = false, baseUrl = "", tokenEnv = DEFAULT_TOKEN_ENV } = {}) {
  const parts = ["pact-mcp", "scan"];
  appendGuidanceContextArgs(parts, { includeUrl, baseUrl, tokenEnv });
  parts.push("--json");
  return parts.join(" ");
}

function shellCommandForDiscoverLocal({ includeUrl = false, baseUrl = "" } = {}) {
  const parts = ["pact-mcp", "discover-local"];
  appendGuidanceContextArgs(parts, { includeUrl, baseUrl, tokenEnv: DEFAULT_TOKEN_ENV });
  parts.push("--json");
  return parts.join(" ");
}

function shellCommandForDoctor({
  includeToken = false,
  includeUrl = false,
  baseUrl = "",
  tokenEnv = DEFAULT_TOKEN_ENV
} = {}) {
  const parts = ["pact-mcp", "doctor"];
  appendGuidanceContextArgs(parts, { includeUrl, baseUrl, tokenEnv });
  if (includeToken) {
    parts.push("--token-stdin");
  }
  parts.push("--json");
  return parts.join(" ");
}

function shellCommandForUninstall({ target = "codex", includeUrl = false, baseUrl = "" } = {}) {
  const parts = ["pact-mcp", "uninstall", "--target", target];
  appendGuidanceContextArgs(parts, { includeUrl, baseUrl, tokenEnv: DEFAULT_TOKEN_ENV });
  parts.push("--json");
  return parts.join(" ");
}

function shellCommandForServerConfig({ baseUrl = "http://127.0.0.1:7228" } = {}) {
  return `pact-mcp server-config --set --url ${shellQuote(normalizeBaseUrl(baseUrl) || "http://127.0.0.1:7228")}`;
}

function githubOneLineInstallGuidance({ includeUrl = false, baseUrl = "", tokenEnv = DEFAULT_TOKEN_ENV } = {}) {
  const command = githubOneLineMcpInstallCommand();
  const commandZhCN = githubOneLineMcpInstallCommand(BOOTSTRAP_INSTALL_SCRIPT_ZH_CN);
  const contextArgs = [
    includeUrl && baseUrl ? ` --url ${shellQuote(baseUrl)}` : "",
    tokenEnv && tokenEnv !== DEFAULT_TOKEN_ENV ? ` --token-env ${shellQuote(tokenEnv)}` : ""
  ].join("");
  const build = (oneLineCommand) => ({
    installCommand: contextArgs ? `${oneLineCommand} --${contextArgs}` : oneLineCommand,
    clientInstallJsonCommand: `${oneLineCommand} -- --target <client>${contextArgs} --json`,
    autoInstallCommand: `${oneLineCommand} -- --target auto${contextArgs} --json`,
    priorityInstallCommand: `${oneLineCommand} -- --target ${PRIORITY_INSTALL_TARGET}${contextArgs} --json`
  });
  const english = build(command);
  const zhCN = build(commandZhCN);
  return {
    githubOneLineCommand: command,
    githubOneLineInstallCommand: english.installCommand,
    githubOneLineClientInstallJsonCommand: english.clientInstallJsonCommand,
    githubOneLineAutoInstallCommand: english.autoInstallCommand,
    githubOneLinePriorityInstallCommand: english.priorityInstallCommand,
    githubOneLineCommandZhCN: commandZhCN,
    githubOneLineInstallCommandZhCN: zhCN.installCommand,
    githubOneLineClientInstallJsonCommandZhCN: zhCN.clientInstallJsonCommand,
    githubOneLineAutoInstallCommandZhCN: zhCN.autoInstallCommand,
    githubOneLinePriorityInstallCommandZhCN: zhCN.priorityInstallCommand,
    oneCommandInstall: english.installCommand,
    oneCommandInstallZhCN: zhCN.installCommand,
    oneCommandClientInstallJson: english.clientInstallJsonCommand,
    oneCommandClientInstallJsonZhCN: zhCN.clientInstallJsonCommand,
    oneCommandAutoInstall: english.autoInstallCommand,
    oneCommandAutoInstallZhCN: zhCN.autoInstallCommand,
    oneCommandPriorityInstall: english.priorityInstallCommand,
    oneCommandPriorityInstallZhCN: zhCN.priorityInstallCommand
  };
}

function installGuidanceMetadata({ includeUrl = false, baseUrl = "", tokenEnv = DEFAULT_TOKEN_ENV } = {}) {
  const oneLineGuidance = githubOneLineInstallGuidance({ includeUrl, baseUrl, tokenEnv });
  return {
    priorityTargets: [...PRIORITY_INSTALL_TARGETS],
    supportedTargets: [...SUPPORTED_TARGETS],
    supportedTargetDetails: supportedTargetDetails(),
    ...oneLineGuidance,
    discoverCommand: shellCommandForDiscoverLocal({ includeUrl, baseUrl }),
    scanCommand: shellCommandForScan({ includeUrl, baseUrl, tokenEnv }),
    doctorCommand: shellCommandForDoctor({ includeUrl, baseUrl, tokenEnv }),
    clientInstallJsonCommand: shellCommandForInstall({ target: "<client>", includeUrl, baseUrl, tokenEnv }),
    autoInstallCommand: shellCommandForInstall({ target: "auto", includeUrl, baseUrl, tokenEnv }),
    priorityInstallCommand: shellCommandForInstall({
      target: PRIORITY_INSTALL_TARGET,
      includeUrl,
      baseUrl,
      tokenEnv
    })
  };
}

function commandFailureGuidance({ command = "", message = "", options = {} } = {}) {
  const normalized = String(message || "");
  const lower = normalized.toLowerCase();
  const { baseUrl, tokenEnv } = commandGuidanceContext(options);
  const includeUrl = Boolean(baseUrl);
  if (/unsupported install target/i.test(normalized)) {
    const scanCommand = shellCommandForScan({ includeUrl, baseUrl, tokenEnv });
    return {
      errorCode: "UNSUPPORTED_TARGET",
      nextCommand: scanCommand,
      repairCommands: [
        scanCommand,
        shellCommandForInstall({ target: "auto", includeUrl, baseUrl, tokenEnv })
      ],
      ...installGuidanceMetadata({ includeUrl, baseUrl, tokenEnv })
    };
  }
  if (lower.includes("no signed pact mcp hub was discovered")) {
    const discoverCommand = shellCommandForDiscoverLocal({ includeUrl, baseUrl });
    const fallbackBaseUrl = baseUrl || "http://127.0.0.1:7228";
    return {
      errorCode: "PACT_HUB_NOT_DISCOVERED",
      nextCommand: discoverCommand,
      repairCommands: [
        discoverCommand,
        shellCommandForServerConfig({ baseUrl: fallbackBaseUrl }),
        shellCommandForInstall({ target: "auto", includeUrl: true, baseUrl: fallbackBaseUrl, tokenEnv })
      ],
      ...installGuidanceMetadata({ includeUrl: true, baseUrl: fallbackBaseUrl, tokenEnv })
    };
  }
  if (lower.includes("missing token")) {
    const target = String(option(options, "target", "codex")) || "codex";
    const urlArgs = baseUrl ? ` --url ${shellQuote(baseUrl)}` : "";
    const tokenEnvArgs = tokenEnv && tokenEnv !== DEFAULT_TOKEN_ENV ? ` --token-env ${shellQuote(tokenEnv)}` : "";
    return {
      errorCode: "MISSING_TOKEN",
      nextCommand: shellCommandForInstall({ target, includeToken: true, includeUrl: Boolean(baseUrl), baseUrl, tokenEnv }),
      repairCommands: [
        shellCommandForInstall({ target, includeToken: true, includeUrl: Boolean(baseUrl), baseUrl, tokenEnv }),
        `${tokenEnv}=your-token pact-mcp ${command || "install"} --target ${target}${urlArgs}${tokenEnvArgs} --json`
      ],
      ...installGuidanceMetadata({ includeUrl: Boolean(baseUrl), baseUrl, tokenEnv })
    };
  }
  if (lower.includes("interactive mode requires a tty")) {
    const uninstallCommand = shellCommandForUninstall({ target: "codex", includeUrl, baseUrl });
    return {
      errorCode: "NON_INTERACTIVE_TARGET_REQUIRED",
      nextCommand: uninstallCommand,
      repairCommands: [
        shellCommandForScan({ includeUrl, baseUrl, tokenEnv }),
        uninstallCommand
      ],
      ...installGuidanceMetadata({ includeUrl, baseUrl, tokenEnv })
    };
  }
  return {
    errorCode: "COMMAND_FAILED",
    nextCommand: command === "install"
      ? shellCommandForInstall({ target: "auto", includeUrl, baseUrl, tokenEnv })
      : shellCommandForDoctor({ includeUrl, baseUrl, tokenEnv }),
    repairCommands: [
      shellCommandForDoctor({ includeUrl, baseUrl, tokenEnv }),
      shellCommandForScan({ includeUrl, baseUrl, tokenEnv })
    ],
    ...installGuidanceMetadata({ includeUrl, baseUrl, tokenEnv })
  };
}

function commandOptionArgs(options = {}) {
  const args = [];
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    args.push(`--${key}`, shellQuote(value));
  }
  return args;
}

function candidateInstallCommand(candidate, settings) {
  const args = ["pact-mcp", "install", "--target", candidate.target];
  if (settings.baseUrl) {
    args.push("--url", shellQuote(settings.baseUrl));
  }
  args.push(...commandOptionArgs(candidate.optionOverrides || {}));
  if (settings.tokenEnv && settings.tokenEnv !== DEFAULT_TOKEN_ENV) {
    args.push("--token-env", shellQuote(settings.tokenEnv));
  }
  args.push("--json");
  return args.join(" ");
}

function candidateRepairCommand(candidate, settings) {
  const binOption = targetBinOption(candidate.target);
  return shellCommandForInstall({
    target: candidate.target,
    binOption,
    includeUrl: Boolean(settings.baseUrl),
    baseUrl: settings.baseUrl || "http://127.0.0.1:7228",
    tokenEnv: settings.tokenEnv || DEFAULT_TOKEN_ENV
  });
}

function candidateDoctorCommand(settings) {
  return shellCommandForDoctor({
    includeUrl: Boolean(settings.baseUrl),
    baseUrl: settings.baseUrl,
    tokenEnv: settings.tokenEnv || DEFAULT_TOKEN_ENV
  });
}

function withInstallCandidateGuidance(candidate, settings) {
  return {
    ...candidate,
    installCommand: candidate.status === "detected" ? candidateInstallCommand(candidate, settings) : "",
    repairCommand: candidate.status === "detected" ? "" : candidateRepairCommand(candidate, settings),
    doctorCommand: candidateDoctorCommand(settings)
  };
}

function doctorGuidance(checks = {}, options = {}) {
  const installedTargets = checks.deviceManifest?.installedTargets || [];
  const { baseUrl, tokenEnv } = commandGuidanceContext(options);
  const includeUrl = Boolean(baseUrl);
  const discoverCommand = shellCommandForDiscoverLocal({ includeUrl, baseUrl });
  const scanCommand = shellCommandForScan({ includeUrl, baseUrl, tokenEnv });
  const installAutoCommand = shellCommandForInstall({ target: "auto", includeUrl, baseUrl, tokenEnv });
  const doctorWithTokenCommand = shellCommandForDoctor({ includeToken: true, includeUrl, baseUrl, tokenEnv });
  if (!checks.signedDiscovery?.ok || !checks.discovery?.ok || !checks.initialize?.ok) {
    return {
      nextCommand: discoverCommand,
      repairCommands: [
        discoverCommand,
        shellCommandForServerConfig({ baseUrl: baseUrl || "http://127.0.0.1:7228" })
      ]
    };
  }
  if (installedTargets.length === 0) {
    return {
      nextCommand: scanCommand,
      repairCommands: [
        scanCommand,
        installAutoCommand
      ]
    };
  }
  if (checks.toolsList?.skipped || checks.systemHealth?.skipped) {
    return {
      nextCommand: doctorWithTokenCommand,
      repairCommands: [
        doctorWithTokenCommand
      ]
    };
  }
  if (!checks.toolsList?.ok || !checks.systemHealth?.ok) {
    return {
      nextCommand: installAutoCommand,
      repairCommands: [
        installAutoCommand,
        doctorWithTokenCommand
      ]
    };
  }
  return {
    nextCommand: "",
    repairCommands: []
  };
}

function redactToken(value) {
  const text = String(value || "");
  if (text.length <= 12) {
    return "***";
  }
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function redactSensitiveText(value, secrets = []) {
  let text = String(value || "");
  for (const secret of uniqueValues(secrets.map((item) => String(item || "")).filter((item) => item.length > 0))) {
    text = text.split(secret).join("<redacted-token>");
  }
  return text
    .replace(/(^|[\s"'=:(])((?:\/(?:Users|home|root|private|var|tmp|opt|usr|Volumes)\/)[^\s"',)\]}]+)/g, "$1<local-path>")
    .replace(/(^|[\s"'=:(])([A-Za-z]:[\\/][^\s"',)\]}]+)/g, "$1<local-path>")
    .replace(/\b(Authorization\s*:\s*Bearer\s+)[^\s"',;)\]}]+/gi, "$1<redacted-token>")
    .replace(/\b(X-Pact-Api-Key\s*:\s*)[^\s"',;)\]}]+/gi, "$1<redacted-token>")
    .replace(/\b(x-pact-tool-token\s*:\s*)[^\s"',;)\]}]+/gi, "$1<redacted-token>")
    .replace(/(^|[\s"'=:(])(--token(?:=|\s+))[^\s"',;)\]}]+/gi, "$1$2<redacted-token>")
    .replace(/\b(token|access_token|refresh_token|api_key|apiKey|secret|password)=([^\s"',;)\]}]+)/gi, "$1=<redacted-secret>");
}

function sensitiveOptionValues(options = {}) {
  const values = [];
  if (options.token) {
    values.push(String(options.token));
  }
  const tokenEnv = String(option(options, "token-env", DEFAULT_TOKEN_ENV));
  const envToken = String(process.env[tokenEnv] || "").trim();
  if (envToken) {
    values.push(envToken);
  }
  return values;
}

function vmBaseUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  return `${parsed.protocol}//host.orb.internal:${port}`;
}

function baseUrlWithHost(baseUrl, host) {
  const parsed = new URL(baseUrl);
  parsed.hostname = host;
  return normalizeBaseUrl(parsed.toString());
}

function isLoopbackHost(hostname) {
  const value = String(hostname || "").toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value === "[::1]";
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function githubOwnerRepo(pkg = packageJson) {
  const repositoryUrl = String(pkg.repository?.url || pkg.homepage || "");
  const match = repositoryUrl.match(/github\.com[:/](.+?)(?:\.git)?(?:#.*)?$/);
  return match?.[1] || "Unka-Malloc/Pact";
}

function githubOneLineMcpInstallCommand(scriptName = BOOTSTRAP_INSTALL_SCRIPT) {
  return `/bin/sh -c "$(curl ${BOOTSTRAP_CURL_FLAGS} https://github.com/${githubOwnerRepo()}/releases/latest/download/${scriptName})"`;
}

function assertSafeEnvName(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name || ""))) {
    throw new Error(`Invalid environment variable name: ${name}`);
  }
  return String(name);
}

function expandHomePath(value) {
  const text = String(value || "").trim();
  if (text === "~") {
    return os.homedir();
  }
  if (text.startsWith("~/")) {
    return path.join(os.homedir(), text.slice(2));
  }
  return text;
}

function discoveryRegistryPath(options = {}) {
  const requested = option(
    options,
    "discovery-file",
    process.env[PACT_MCP_DISCOVERY_FILE_ENV] || DEFAULT_DISCOVERY_REGISTRY
  );
  return path.resolve(expandHomePath(requested));
}

function deviceDiscoveryPaths(options = {}) {
  return [discoveryRegistryPath(options)];
}

function deviceDiscoveryEnv({ baseUrl, primaryPath }) {
  return {
    [PACT_MCP_URL_ENV]: `${baseUrl}/mcp`,
    [PACT_MCP_DISCOVERY_URL_ENV]: `${baseUrl}/.well-known/pact/mcp.json`,
    [PACT_MCP_DISCOVERY_FILE_ENV]: primaryPath
  };
}

function childProcessEnv(extraEnv = {}) {
  return {
    ...process.env,
    ...PACKAGE_MANAGER_DISCOVERY_ENV,
    ...(extraEnv || {})
  };
}

async function run(command, args = [], options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd || process.cwd(),
      env: childProcessEnv(options.env),
      timeout: options.timeoutMs || 0,
      killSignal: options.killSignal || "SIGKILL",
      maxBuffer: 10 * 1024 * 1024
    });
    return {
      ok: true,
      stdout: result.stdout || "",
      stderr: result.stderr || ""
    };
  } catch (error) {
    const timeoutMessage = options.timeoutMs && error?.killed
      ? `command timed out after ${options.timeoutMs} ms`
      : "";
    if (options.allowFailure) {
      return {
        ok: false,
        stdout: error.stdout || "",
        stderr: error.stderr || timeoutMessage || error.message || ""
      };
    }
    const message = error.stderr || error.stdout || timeoutMessage || error.message || "command failed";
    throw new Error(`${command} failed: ${message}`);
  }
}

async function runInstallCommand(command, args = [], options = {}) {
  return run(command, args, {
    ...options,
    timeoutMs: options.timeoutMs || INSTALL_COMMAND_TIMEOUT_MS
  });
}

async function runWithInput(command, args = [], input = "", options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = Number(options.timeoutMs || 0);
    const useProcessGroup = timeoutMs > 0 && process.platform !== "win32";
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: childProcessEnv(options.env),
      stdio: ["pipe", "pipe", "pipe"],
      detached: useProcessGroup
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          const signal = options.killSignal || "SIGKILL";
          try {
            if (useProcessGroup && child.pid) {
              process.kill(-child.pid, signal);
            } else {
              child.kill(signal);
            }
          } catch {
            try {
              child.kill(signal);
            } catch {
              // The process may have exited between timeout firing and signal delivery.
            }
          }
        }, timeoutMs)
      : null;
    const settle = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      callback();
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      settle(() => {
        if (options.allowFailure) {
          resolve({ ok: false, stdout, stderr: stderr || error.message || "" });
          return;
        }
        reject(error);
      });
    });
    child.on("close", (code) => {
      settle(() => {
        if (timedOut) {
          const timeoutMessage = `command timed out after ${timeoutMs} ms`;
          if (options.allowFailure) {
            resolve({ ok: false, stdout, stderr: stderr || timeoutMessage });
            return;
          }
          reject(new Error(timeoutMessage));
          return;
        }
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
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])])
    );
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function verifySignedPayload({ publicKeyJwk, payload, signature }) {
  const publicKey = createPublicKey({ key: publicKeyJwk, format: "jwk" });
  return verify(
    null,
    Buffer.from(stableStringify(payload)),
    publicKey,
    Buffer.from(String(signature || ""), "base64url")
  );
}

async function fetchJson(url, options = {}) {
  const { timeoutMs = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: fetchOptions.signal || controller.signal
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      payload: text.trim() ? JSON.parse(text) : {}
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value);
}

async function backupIfExists(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    return "";
  }
  const backupPath = `${filePath}.pact-backup-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z")}`;
  await fs.copyFile(filePath, backupPath);
  return backupPath;
}

async function removeDirIfExists(dirPath) {
  await fs.rm(dirPath, { recursive: true, force: true });
}

async function removeCodexMarketplacePlugin({ marketplaceRoot }) {
  const marketplacePath = path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json");
  const marketplace = await readJson(marketplacePath, null);
  if (!marketplace?.plugins) {
    return "";
  }
  const plugins = marketplace.plugins.filter((plugin) => plugin?.name !== PLUGIN_NAME);
  if (plugins.length === marketplace.plugins.length) {
    return "";
  }
  const backupPath = await backupIfExists(marketplacePath);
  await writeJson(marketplacePath, {
    ...marketplace,
    plugins
  });
  return backupPath;
}

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function readLaunchctlEnv(name) {
  if (process.platform !== "darwin") {
    return "";
  }
  const result = await run("launchctl", ["getenv", name], { allowFailure: true });
  return result.ok ? result.stdout.trim() : "";
}

function explicitBaseUrl(options = {}) {
  return normalizeBaseUrl(option(options, "url", process.env.PACT_MCP_BASE_URL || ""));
}

function baseUrlFromEndpoint(value) {
  const text = normalizeBaseUrl(value);
  if (!text) {
    return "";
  }
  try {
    const parsed = new URL(text);
    if (parsed.pathname === "/mcp") {
      parsed.pathname = "/";
      parsed.search = "";
      parsed.hash = "";
      return normalizeBaseUrl(parsed.toString());
    }
    if (
      parsed.pathname === "/api/mcp/discovery" ||
      parsed.pathname === "/.well-known/pact/mcp.json" ||
      parsed.pathname === "/api/mcp/handshake"
    ) {
      parsed.pathname = "/";
      parsed.search = "";
      parsed.hash = "";
      return normalizeBaseUrl(parsed.toString());
    }
    return text;
  } catch {
    return "";
  }
}

function parseScanPorts(options = {}) {
  const raw = String(option(options, "scan-ports", process.env.PACT_MCP_SCAN_PORTS || "")).trim();
  const values = raw
    ? raw.split(",").map((item) => Number(item.trim()))
    : DEFAULT_SCAN_PORTS;
  return uniqueValues(values
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)
    .map(String))
    .map(Number);
}

async function registryBaseUrls(options = {}) {
  const payload = await readJson(discoveryRegistryPath(options), null);
  const server = payload?.servers?.[MCP_SERVER_NAME] || payload?.mcpServers?.[MCP_SERVER_NAME] || {};
  const profiles = Object.values(payload?.serverConfig?.profiles || {});
  const activeProfile = payload?.serverConfig?.activeName
    ? payload?.serverConfig?.profiles?.[payload.serverConfig.activeName]
    : null;
  return uniqueValues([
    activeProfile?.baseUrl,
    baseUrlFromEndpoint(server.httpUrl),
    baseUrlFromEndpoint(server.url),
    baseUrlFromEndpoint(payload?.discovery?.preferredHttpDiscoveryUrl),
    baseUrlFromEndpoint(payload?.discovery?.preferredApiDiscoveryUrl),
    ...profiles.map((profile) => profile?.baseUrl)
  ]);
}

async function candidateBaseUrls(options = {}) {
  const explicit = explicitBaseUrl(options);
  if (explicit) {
    return [explicit];
  }
  const launchDiscoveryFile = await readLaunchctlEnv(PACT_MCP_DISCOVERY_FILE_ENV);
  const launchDiscoveryUrl = await readLaunchctlEnv(PACT_MCP_DISCOVERY_URL_ENV);
  const launchMcpUrl = await readLaunchctlEnv(PACT_MCP_URL_ENV);
  const fileCandidates = uniqueValues([
    discoveryRegistryPath(options),
    launchDiscoveryFile
  ]);
  const fromFiles = [];
  for (const filePath of fileCandidates) {
    const payload = await readJson(filePath, null);
    const server = payload?.servers?.[MCP_SERVER_NAME] || payload?.mcpServers?.[MCP_SERVER_NAME] || {};
    const profiles = Object.values(payload?.serverConfig?.profiles || {});
    const activeProfile = payload?.serverConfig?.activeName
      ? payload?.serverConfig?.profiles?.[payload.serverConfig.activeName]
      : null;
    fromFiles.push(
      activeProfile?.baseUrl,
      baseUrlFromEndpoint(server.httpUrl),
      baseUrlFromEndpoint(server.url),
      baseUrlFromEndpoint(payload?.discovery?.preferredHttpDiscoveryUrl),
      baseUrlFromEndpoint(payload?.discovery?.preferredApiDiscoveryUrl),
      ...profiles.map((profile) => profile?.baseUrl)
    );
  }
  const scanned = parseScanPorts(options).flatMap((port) => [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`
  ]);
  return uniqueValues([
    baseUrlFromEndpoint(process.env[PACT_MCP_URL_ENV]),
    baseUrlFromEndpoint(process.env[PACT_MCP_DISCOVERY_URL_ENV]),
    baseUrlFromEndpoint(launchMcpUrl),
    baseUrlFromEndpoint(launchDiscoveryUrl),
    ...fromFiles,
    ...scanned
  ]).map(normalizeBaseUrl);
}

async function fetchPactDiscovery(baseUrl) {
  const url = `${baseUrl}/api/mcp/discovery`;
  const result = await fetchJson(url, { timeoutMs: 1500 });
  const payload = result.payload || {};
  const identity = payload.identity || null;
  if (
    !result.ok ||
    payload.name !== "Pact" ||
    payload.interfaceVersion !== MCP_INTERFACE_VERSION ||
    payload.stableToolName !== MCP_STABLE_TOOL_NAME ||
    identity?.algorithm !== "Ed25519" ||
    !identity?.publicKeyJwk ||
    !payload.handshake?.url
  ) {
    throw new Error("not an Pact MCP discovery response");
  }
  return payload;
}

async function verifyPactHandshake(baseUrl, discovery) {
  const nonce = randomBytes(32).toString("base64url");
  const result = await fetchJson(`${baseUrl}/api/mcp/handshake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nonce,
      client: {
        name: packageJson.name,
        version: packageJson.version
      }
    }),
    timeoutMs: 2500
  });
  const payload = result.payload?.payload || {};
  const signature = result.payload?.signature || {};
  const publicKeyJwk = payload.identity?.publicKeyJwk;
  if (
    !result.ok ||
    result.payload?.ok !== true ||
    payload.schemaVersion !== "v0.0.1:mcp:handshake-1" ||
    payload.nonce !== nonce ||
    payload.server?.name !== "Pact" ||
    payload.server?.interfaceVersion !== MCP_INTERFACE_VERSION ||
    payload.server?.stableToolName !== MCP_STABLE_TOOL_NAME ||
    payload.identity?.keyId !== discovery.identity?.keyId ||
    signature.algorithm !== "Ed25519" ||
    !verifySignedPayload({ publicKeyJwk, payload, signature: signature.value })
  ) {
    throw new Error("Pact MCP handshake signature verification failed");
  }
  return {
    ok: true,
    baseUrl,
    discovery,
    handshake: result.payload
  };
}

async function discoverPactHub(options = {}) {
  const attempts = [];
  const candidates = await candidateBaseUrls(options);
  for (const baseUrl of candidates) {
    try {
      const discovery = await fetchPactDiscovery(baseUrl);
      const verified = await verifyPactHandshake(baseUrl, discovery);
      return {
        ...verified,
        attempts: [
          ...attempts,
          { baseUrl, ok: true, verified: true }
        ]
      };
    } catch (error) {
      attempts.push({
        baseUrl,
        ok: false,
        verified: false,
        reason: error?.name === "AbortError" ? "timeout" : error?.message || String(error)
      });
    }
  }
  return {
    ok: false,
    attempts,
    reason: "No signed Pact MCP hub was discovered on this device."
  };
}

async function optionsWithDiscoveredBaseUrl(options = {}) {
  const discovered = await discoverPactHub(options);
  if (!discovered.ok) {
    throw new Error(`${discovered.reason} Use --url only if you know the Pact base URL; it will still be handshake-verified.`);
  }
  return {
    ...options,
    "resolved-url": discovered.baseUrl,
    __pactDiscovery: discovered
  };
}

async function publishLaunchctlEnv(env) {
  if (process.platform === "darwin") {
    for (const [name, value] of Object.entries(env)) {
      await run("launchctl", ["setenv", name, value], { allowFailure: true });
    }
    return true;
  }
  
  if (process.platform === "win32") {
    for (const [name, value] of Object.entries(env)) {
      await run("setx", [name, value], { allowFailure: true });
    }
    return true;
  }

  process.stderr.write("\n[Notice] Please add the following to your ~/.bashrc or ~/.zshrc:\n");
  for (const [name, value] of Object.entries(env)) {
    process.stderr.write(`export ${name}="${value}"\n`);
  }
  process.stderr.write("\n");
  return false;
}

async function resolveToken(options, { required = false } = {}) {
  if (options.token) {
    return String(options.token).trim();
  }
  if (options["token-stdin"]) {
    return (await readStdin()).trim();
  }
  const tokenEnv = String(option(options, "token-env", DEFAULT_TOKEN_ENV));
  const envToken = String(process.env[tokenEnv] || "").trim();
  if (envToken) {
    return envToken;
  }
  const launchctlToken = await readLaunchctlEnv(tokenEnv);
  if (launchctlToken) {
    return launchctlToken;
  }
  if (required) {
    throw new Error(`Missing token. Provide --token-stdin, --token, or ${tokenEnv}.`);
  }
  return "";
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
        clientInfo: { name: "pact-mcp-connector", version: packageJson.version }
      }
    })
  });
  if (!initialize.ok || initialize.payload?.result?.serverInfo?.name !== "Pact") {
    throw new Error(`Pact MCP is not available at ${baseUrl}/mcp.`);
  }
  return initialize;
}

function authHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-Pact-Api-Key": token
  };
}

async function verifyMcpTools({ baseUrl, token }) {
  const toolsList = await fetchJson(`${baseUrl}/mcp`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
  });
  const health = await fetchJson(`${baseUrl}/mcp`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: MCP_STABLE_TOOL_NAME,
        arguments: {
          apiVersion: MCP_INTERFACE_VERSION,
          operation: "system.health",
          input: {},
          clientVersion: packageJson.version
        }
      }
    })
  });
  const tools = toolsList.payload?.result?.tools || [];
  const expectedOutlets = [
    "pact.discovery",
    "pact.agentLibrary",
    "pact.sharedspace",
    "pact.codespace",
    "pact.skillHub",
    "pact.agentRelay",
    "pact.serviceHub"
  ];
  const toolNames = new Set(tools.map((tool) => tool.name));
  const hasStableOutlet = toolNames.has(MCP_STABLE_TOOL_NAME);
  const hasSevenOutlets = expectedOutlets.every((name) => toolNames.has(name));
  if (
    !toolsList.ok
    || !health.ok
    || tools.length !== expectedOutlets.length
    || !hasStableOutlet
    || !hasSevenOutlets
    || health.payload?.result?.structuredContent?.payload?.ok !== true
  ) {
    throw new Error("MCP HTTP verification failed.");
  }
  const runtimeMeta = toolsList.payload?.result?._meta || {};
  const runtimeSupportedTargets = Array.isArray(runtimeMeta.supportedTargets)
    ? runtimeMeta.supportedTargets.map((target) => target.target).filter(Boolean)
    : [];
  return {
    toolCount: tools.length,
    stableToolName: tools.find(t => t.name === MCP_STABLE_TOOL_NAME)?.name || "",
    systemHealthOk: health.payload?.result?.structuredContent?.payload?.ok === true,
    sharedHubOk: runtimeMeta.sharedHub?.sharedspace?.outlet === "pact.sharedspace",
    priorityTargets: Array.isArray(runtimeMeta.priorityTargets) ? runtimeMeta.priorityTargets : [],
    supportedTargets: runtimeSupportedTargets
  };
}

async function createCodexPlugin({ marketplaceRoot, baseUrl, tokenEnv }) {
  const pluginRoot = path.join(marketplaceRoot, "plugins", PLUGIN_NAME);
  await fs.mkdir(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
  await writeJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"), {
    name: PLUGIN_NAME,
    version: packageJson.version,
    description: "Pact MCP integration for Codex.",
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
      shortDescription: "Connect Codex to Pact MCP",
      longDescription: "Use the Pact HTTP MCP endpoint through the stable seven-outlet MCP surface.",
      developerName: "Unka-Malloc",
      category: "Coding",
      capabilities: ["Interactive", "Read", "Write"],
      websiteURL: "https://github.com/Unka-Malloc/Pact",
      privacyPolicyURL: "https://github.com/Unka-Malloc/Pact",
      termsOfServiceURL: "https://github.com/Unka-Malloc/Pact",
      defaultPrompt: ["Use Pact MCP through the stable pact.discovery, pact.agentLibrary, pact.sharedspace, pact.codespace, pact.skillHub, pact.agentRelay, and pact.serviceHub outlets"],
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
        note: "Pact Unified Agent Workspace MCP. Provides seven stable outlets: Discovery, Agent Library, Shared Space, Code Space, Skill Hub, Agent Relay, and ServiceHub. Token is provided through PACT_MCP_TOKEN by the connector installer."
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
  await runInstallCommand("launchctl", ["setenv", tokenEnv, token], { allowFailure: true });
  process.env[tokenEnv] = token;
  const plugin = await createCodexPlugin({ marketplaceRoot, baseUrl, tokenEnv });
  await runInstallCommand(codexBin, ["plugin", "marketplace", "add", marketplaceRoot], { allowFailure: true });
  await runInstallCommand(codexBin, ["plugin", "remove", `${PLUGIN_NAME}@${MARKETPLACE_NAME}`], { allowFailure: true });
  const pluginAdd = await runInstallCommand(codexBin, ["plugin", "add", `${PLUGIN_NAME}@${MARKETPLACE_NAME}`], { allowFailure: true });
  await runInstallCommand(codexBin, ["mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  await runInstallCommand(codexBin, [
    "mcp",
    "add",
    MCP_SERVER_NAME,
    "--url",
    `${baseUrl}/mcp`,
    "--bearer-token-env-var",
    tokenEnv
  ]);
  const mcpGet = await runInstallCommand(codexBin, ["mcp", "get", MCP_SERVER_NAME], {
    env: { [tokenEnv]: token }
  });
  return {
    installMode: "codex-release-plugin-and-mcp-cli",
    plugin: pluginAdd.ok ? `${PLUGIN_NAME}@${MARKETPLACE_NAME}` : null,
    pluginAddOk: pluginAdd.ok,
    pluginAddError: pluginAdd.ok ? null : `${(pluginAdd.stderr || pluginAdd.stdout || "").trim()}`,
    pluginRoot: plugin.pluginRoot,
    marketplacePath: plugin.marketplacePath,
    mcpGet: mcpGet.stdout
  };
}

function codexMcpAddArgs({ baseUrl, tokenEnv }) {
  return [
    "mcp",
    "add",
    MCP_SERVER_NAME,
    "--url",
    `${baseUrl}/mcp`,
    "--bearer-token-env-var",
    tokenEnv
  ];
}

function codexRemoteTokenEnvScript() {
  return [
    "set -e",
    "IFS= read -r token",
    "env_name=\"$PACT_TOKEN_ENV\"",
    "case \"$env_name\" in",
    "  ''|*[!A-Za-z0-9_]*|[0-9]*) echo 'invalid token env' >&2; exit 2 ;;",
    "esac",
    "mkdir -p \"$HOME/.pact/mcp\"",
    "umask 077",
    "escaped=$(printf '%s' \"$token\" | sed \"s/'/'\\\\''/g\")",
    "printf \"export %s='%s'\\n\" \"$env_name\" \"$escaped\" > \"$HOME/.pact/mcp/env\"",
    "profile=\"$HOME/.profile\"",
    "if ! grep -q 'Pact MCP token env' \"$profile\" 2>/dev/null; then",
    "  printf '\\n# Pact MCP token env\\n[ -f \"$HOME/.pact/mcp/env\" ] && . \"$HOME/.pact/mcp/env\"\\n' >> \"$profile\"",
    "fi"
  ].join("\n");
}

async function installCodexOrb({ baseUrl, token, tokenEnv, orbBin, vmName, vmUser, codexBin }) {
  if (!vmName || !vmUser || !codexBin) {
    throw new Error("Codex VM install requires a discovered or explicit OrbStack VM, user, and codex CLI path.");
  }
  assertSafeEnvName(tokenEnv);
  const urlBase = vmBaseUrl(baseUrl);
  const envWrite = await runWithInput(orbBin, [
    "-m",
    vmName,
    "-u",
    vmUser,
    "env",
    `PACT_TOKEN_ENV=${tokenEnv}`,
    "bash",
    "-lc",
    codexRemoteTokenEnvScript()
  ], `${token}\n`, { allowFailure: true, timeoutMs: INSTALL_COMMAND_TIMEOUT_MS });
  if (!envWrite.ok) {
    throw new Error(`Codex VM token environment setup failed: ${envWrite.stderr || envWrite.stdout}`);
  }
  await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, codexBin, "mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, codexBin, ...codexMcpAddArgs({ baseUrl: urlBase, tokenEnv })]);
  const mcpGet = await runInstallCommand(orbBin, [
    "-m",
    vmName,
    "-u",
    vmUser,
    "env",
    `${tokenEnv}=${token}`,
    codexBin,
    "mcp",
    "get",
    MCP_SERVER_NAME
  ]);
  return {
    installMode: "codex-orbstack-mcp-cli",
    vm: vmName,
    vmUser,
    url: `${urlBase}/mcp`,
    tokenEnv,
    mcpGetHasPact: mcpOutputHasPact(mcpGet)
  };
}

async function installCodexRemote({ baseUrl, token, tokenEnv, context, codexBin }) {
  if (!context?.kind || !context?.id || !context?.bin || !codexBin) {
    throw new Error("Codex remote install requires a discovered remote context and codex CLI path.");
  }
  assertSafeEnvName(tokenEnv);
  const urlBase = await remoteClientBaseUrl(context, baseUrl);
  const envWrite = await remoteLinuxShellWithInput(context, codexRemoteTokenEnvScript(), `${token}\n`, {
    PACT_TOKEN_ENV: tokenEnv
  });
  if (!envWrite.ok) {
    throw new Error(`Codex remote token environment setup failed in ${remoteContextLabel(context)}: ${envWrite.stderr || envWrite.stdout}`);
  }
  await runRemoteLinuxCommand(context, [codexBin, "mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  await runRemoteLinuxCommand(context, [codexBin, ...codexMcpAddArgs({ baseUrl: urlBase, tokenEnv })]);
  const mcpGet = await runRemoteLinuxCommand(context, [
    "env",
    `${tokenEnv}=${token}`,
    codexBin,
    "mcp",
    "get",
    MCP_SERVER_NAME
  ]);
  return {
    installMode: `codex-${context.kind}-mcp-cli`,
    remote: remoteContextLabel(context),
    url: `${urlBase}/mcp`,
    tokenEnv,
    mcpGetHasPact: mcpOutputHasPact(mcpGet)
  };
}

function claudeCodeServerJson({ baseUrl, token }) {
  return JSON.stringify({
    type: "http",
    url: `${baseUrl}/mcp`,
    headers: {
      "X-Pact-Api-Key": token
    }
  });
}

async function installClaudeCode({ baseUrl, token, claudeBin }) {
  await runInstallCommand(claudeBin, ["mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  await runInstallCommand(claudeBin, [
    "mcp",
    "add-json",
    "--scope",
    "user",
    MCP_SERVER_NAME,
    claudeCodeServerJson({ baseUrl, token })
  ]);
  const get = await runInstallCommand(claudeBin, ["mcp", "get", MCP_SERVER_NAME]);
  return {
    installMode: "claude-code-release-mcp-cli",
    mcpGetHasPact: get.stdout.includes(MCP_SERVER_NAME) || get.stdout.includes(`${baseUrl}/mcp`)
  };
}

async function installClaudeCodeOrb({ baseUrl, token, orbBin, vmName, vmUser, claudeBin }) {
  if (!vmName || !vmUser || !claudeBin) {
    throw new Error("Claude Code VM install requires a discovered or explicit OrbStack VM, user, and claude CLI path.");
  }
  const url = `${vmBaseUrl(baseUrl)}/mcp`;
  await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, claudeBin, "mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  await runInstallCommand(orbBin, [
    "-m",
    vmName,
    "-u",
    vmUser,
    claudeBin,
    "mcp",
    "add-json",
    "--scope",
    "user",
    MCP_SERVER_NAME,
    claudeCodeServerJson({ baseUrl: vmBaseUrl(baseUrl), token })
  ]);
  const get = await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, claudeBin, "mcp", "get", MCP_SERVER_NAME]);
  return {
    installMode: "claude-code-orbstack-mcp-cli",
    vm: vmName,
    vmUser,
    url,
    mcpGetHasPact: get.stdout.includes(MCP_SERVER_NAME) || get.stdout.includes(url)
  };
}

async function installClaudeCodeRemote({ baseUrl, token, context, claudeBin }) {
  if (!context?.kind || !context?.id || !context?.bin || !claudeBin) {
    throw new Error("Claude Code remote install requires a discovered remote context and claude CLI path.");
  }
  const urlBase = await remoteClientBaseUrl(context, baseUrl);
  const url = `${urlBase}/mcp`;
  await runRemoteLinuxCommand(context, [claudeBin, "mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  await runRemoteLinuxCommand(context, [
    claudeBin,
    "mcp",
    "add-json",
    "--scope",
    "user",
    MCP_SERVER_NAME,
    claudeCodeServerJson({ baseUrl: urlBase, token })
  ]);
  const get = await runRemoteLinuxCommand(context, [claudeBin, "mcp", "get", MCP_SERVER_NAME]);
  return {
    installMode: `claude-code-${context.kind}-mcp-cli`,
    remote: remoteContextLabel(context),
    url,
    mcpGetHasPact: get.stdout.includes(MCP_SERVER_NAME) || get.stdout.includes(url)
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
  const list = await runInstallCommand(kiloBin, ["mcp", "list"], { allowFailure: true });
  return {
    installMode: "kilo-release-global-kilo-json",
    configPath: kiloConfigPath,
    backupPath,
    mcpListHasPact: list.stdout.includes(MCP_SERVER_NAME) || list.stderr.includes(MCP_SERVER_NAME)
  };
}

async function installKiloOrb({ baseUrl, token, orbBin, vmName, vmUser, kiloBin }) {
  if (!vmName || !vmUser || !kiloBin) {
    throw new Error("Kilo VM install requires a discovered or explicit OrbStack VM, user, and kilo CLI path.");
  }
  const url = `${vmBaseUrl(baseUrl)}/mcp`;
  const script = [
    "set -e",
    "IFS= read -r token",
    "node - \"$PACT_URL\" \"$token\" <<'NODE'",
    "const fs = require('fs');",
    "const os = require('os');",
    "const path = require('path');",
    "const url = process.argv[2];",
    "const token = process.argv[3];",
    "const filePath = path.join(os.homedir(), '.config', 'kilo', 'kilo.json');",
    "fs.mkdirSync(path.dirname(filePath), { recursive: true });",
    "let config = {};",
    "try { config = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}",
    "config.mcp = {",
    "  ...(config.mcp || {}),",
    "  pact: {",
    "    type: 'remote',",
    "    url,",
    "    enabled: true,",
    "    headers: { 'X-Pact-Api-Key': token },",
    `    timeout: ${HTTP_TIMEOUT_MS}`,
    "  }",
    "};",
    "fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\\n`);",
    "NODE",
    "\"$KILO_BIN\" mcp list >/dev/null 2>&1 || true"
  ].join("\n");
  await runWithInput(orbBin, [
    "-m",
    vmName,
    "-u",
    vmUser,
    "env",
    `KILO_BIN=${kiloBin}`,
    `PACT_URL=${url}`,
    "bash",
    "-lc",
    script
  ], `${token}\n`, { timeoutMs: INSTALL_COMMAND_TIMEOUT_MS });
  return {
    installMode: "kilo-orbstack-global-kilo-json",
    vm: vmName,
    vmUser,
    url,
    configPath: "~/.config/kilo/kilo.json"
  };
}

async function installKiloRemote({ baseUrl, token, context, kiloBin }) {
  if (!context?.kind || !context?.id || !context?.bin || !kiloBin) {
    throw new Error("Kilo remote install requires a discovered remote context and kilo CLI path.");
  }
  const url = `${await remoteClientBaseUrl(context, baseUrl)}/mcp`;
  const script = [
    "set -e",
    "IFS= read -r token",
    "node - \"$PACT_URL\" \"$token\" <<'NODE'",
    "const fs = require('fs');",
    "const os = require('os');",
    "const path = require('path');",
    "const url = process.argv[2];",
    "const token = process.argv[3];",
    "const filePath = path.join(os.homedir(), '.config', 'kilo', 'kilo.json');",
    "fs.mkdirSync(path.dirname(filePath), { recursive: true });",
    "let config = {};",
    "try { config = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}",
    "config.mcp = {",
    "  ...(config.mcp || {}),",
    "  pact: {",
    "    type: 'remote',",
    "    url,",
    "    enabled: true,",
    "    headers: { 'X-Pact-Api-Key': token },",
    `    timeout: ${HTTP_TIMEOUT_MS}`,
    "  }",
    "};",
    "fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\\n`);",
    "NODE",
    "\"$KILO_BIN\" mcp list >/dev/null 2>&1 || true"
  ].join("\n");
  const result = await remoteLinuxShellWithInput(context, script, `${token}\n`, {
    KILO_BIN: kiloBin,
    PACT_URL: url
  });
  if (!result.ok) {
    throw new Error(`Kilo remote install failed in ${remoteContextLabel(context)}: ${result.stderr || result.stdout}`);
  }
  return {
    installMode: `kilo-${context.kind}-global-kilo-json`,
    remote: remoteContextLabel(context),
    url,
    configPath: "~/.config/kilo/kilo.json"
  };
}

async function installCopilot({ baseUrl, token, copilotBin }) {
  await runInstallCommand(copilotBin, ["mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  await runInstallCommand(copilotBin, [
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
  const get = await runInstallCommand(copilotBin, ["mcp", "get", MCP_SERVER_NAME]);
  return {
    installMode: "copilot-release-mcp-cli",
    mcpGetHasPact: get.stdout.includes(MCP_SERVER_NAME) || get.stdout.includes(`${baseUrl}/mcp`)
  };
}

async function installCopilotOrb({ baseUrl, token, orbBin, vmName, vmUser, copilotBin }) {
  if (!vmName || !vmUser || !copilotBin) {
    throw new Error("Copilot VM install requires a discovered or explicit OrbStack VM, user, and copilot CLI path.");
  }
  const url = `${vmBaseUrl(baseUrl)}/mcp`;
  await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, copilotBin, "mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  await runInstallCommand(orbBin, [
    "-m",
    vmName,
    "-u",
    vmUser,
    copilotBin,
    "mcp",
    "add",
    "--transport",
    "http",
    "--header",
    `X-Pact-Api-Key: ${token}`,
    "--timeout",
    String(HTTP_TIMEOUT_MS),
    MCP_SERVER_NAME,
    url
  ]);
  const get = await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, copilotBin, "mcp", "get", MCP_SERVER_NAME]);
  return {
    installMode: "copilot-orbstack-mcp-cli",
    vm: vmName,
    vmUser,
    url,
    mcpGetHasPact: get.stdout.includes(MCP_SERVER_NAME) || get.stdout.includes(url)
  };
}

async function installCopilotRemote({ baseUrl, token, context, copilotBin }) {
  if (!context?.kind || !context?.id || !context?.bin || !copilotBin) {
    throw new Error("Copilot remote install requires a discovered remote context and copilot CLI path.");
  }
  const url = `${await remoteClientBaseUrl(context, baseUrl)}/mcp`;
  await runRemoteLinuxCommand(context, [copilotBin, "mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  await runRemoteLinuxCommand(context, [
    copilotBin,
    "mcp",
    "add",
    "--transport",
    "http",
    "--header",
    `X-Pact-Api-Key: ${token}`,
    "--timeout",
    String(HTTP_TIMEOUT_MS),
    MCP_SERVER_NAME,
    url
  ]);
  const get = await runRemoteLinuxCommand(context, [copilotBin, "mcp", "get", MCP_SERVER_NAME]);
  return {
    installMode: `copilot-${context.kind}-mcp-cli`,
    remote: remoteContextLabel(context),
    url,
    mcpGetHasPact: get.stdout.includes(MCP_SERVER_NAME) || get.stdout.includes(url)
  };
}

async function installAntigravity({ baseUrl, token, configPath }) {
  return installMcpServersJsonConfig({
    baseUrl,
    token,
    configPath,
    installMode: "antigravity-release-mcp-config",
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
    installMode: "opencode-release-mcp-config",
    configPath,
    backupPath
  };
}

function openCodeRemoteInstallScript() {
  return [
    "set -e",
    "IFS= read -r token",
    "node - \"$PACT_URL\" \"$token\" <<'NODE'",
    "const fs = require('fs');",
    "const os = require('os');",
    "const path = require('path');",
    "const url = process.argv[2];",
    "const token = process.argv[3];",
    "const filePath = path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc');",
    "fs.mkdirSync(path.dirname(filePath), { recursive: true });",
    "let config = {};",
    "try { config = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}",
    "config.mcp = {",
    "  ...(config.mcp || {}),",
    "  pact: {",
    "    type: 'remote',",
    "    url,",
    "    headers: { 'X-Pact-Api-Key': token },",
    "    enabled: true",
    "  }",
    "};",
    "fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\\n`);",
    "NODE"
  ].join("\n");
}

function openCodeRemoteUninstallScript() {
  return [
    "set -e",
    "node - <<'NODE'",
    "const fs = require('fs');",
    "const os = require('os');",
    "const path = require('path');",
    "const filePath = path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc');",
    "let config = {};",
    "try { config = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { console.log('not-installed'); process.exit(0); }",
    "const removed = Boolean(config.mcp && Object.prototype.hasOwnProperty.call(config.mcp, 'pact'));",
    "if (removed) {",
    "  delete config.mcp.pact;",
    "  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\\n`);",
    "}",
    "console.log(removed ? 'removed' : 'not-installed');",
    "NODE"
  ].join("\n");
}

async function installOpenCodeOrb({ baseUrl, token, orbBin, vmName, vmUser }) {
  if (!vmName || !vmUser) {
    throw new Error("OpenCode VM install requires a discovered or explicit OrbStack VM and user.");
  }
  const url = `${vmBaseUrl(baseUrl)}/mcp`;
  const result = await runWithInput(orbBin, [
    "-m",
    vmName,
    "-u",
    vmUser,
    "env",
    `PACT_URL=${url}`,
    "bash",
    "-lc",
    openCodeRemoteInstallScript()
  ], `${token}\n`, { allowFailure: true, timeoutMs: INSTALL_COMMAND_TIMEOUT_MS });
  if (!result.ok) {
    throw new Error(`OpenCode VM install failed: ${result.stderr || result.stdout}`);
  }
  return {
    installMode: "opencode-orbstack-mcp-config",
    vm: vmName,
    vmUser,
    url,
    configPath: "~/.config/opencode/opencode.jsonc"
  };
}

async function installOpenCodeRemote({ baseUrl, token, context }) {
  if (!context?.kind || !context?.id || !context?.bin) {
    throw new Error("OpenCode remote install requires a discovered remote context.");
  }
  const url = `${await remoteClientBaseUrl(context, baseUrl)}/mcp`;
  const result = await remoteLinuxShellWithInput(context, openCodeRemoteInstallScript(), `${token}\n`, {
    PACT_URL: url
  });
  if (!result.ok) {
    throw new Error(`OpenCode remote install failed in ${remoteContextLabel(context)}: ${result.stderr || result.stdout}`);
  }
  return {
    installMode: `opencode-${context.kind}-mcp-config`,
    remote: remoteContextLabel(context),
    url,
    configPath: "~/.config/opencode/opencode.jsonc"
  };
}

async function installOpenClaw({ baseUrl, token, orbBin, vmName, vmUser, openclawBin }) {
  if (!openclawBin) {
    throw new Error("OpenClaw install requires a discovered or explicit OpenClaw-like CLI path.");
  }
  const isOrb = Boolean(vmName || vmUser);
  if (isOrb && (!vmName || !vmUser)) {
    throw new Error("OpenClaw VM install requires both OrbStack VM and user.");
  }
  const url = isOrb ? `${vmBaseUrl(baseUrl)}/mcp` : `${baseUrl}/mcp`;
  const config = {
    type: "http",
    url,
    headers: {
      "X-Pact-Api-Key": token
    },
    timeout: HTTP_TIMEOUT_MS,
    enabled: true
  };
  if (isOrb) {
    await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, openclawBin, "mcp", "set", MCP_SERVER_NAME, JSON.stringify(config)]);
  } else {
    await runInstallCommand(openclawBin, ["mcp", "set", MCP_SERVER_NAME, JSON.stringify(config)]);
  }
  const show = isOrb
    ? await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, openclawBin, "mcp", "show", MCP_SERVER_NAME])
    : await runInstallCommand(openclawBin, ["mcp", "show", MCP_SERVER_NAME]);
  return {
    installMode: isOrb ? "openclaw-orbstack-mcp-cli" : "openclaw-release-mcp-cli",
    vm: vmName,
    vmUser,
    url,
    mcpShowHasPact: show.stdout.includes(MCP_SERVER_NAME) || show.stdout.includes(url)
  };
}

async function installOpenClawRemote({ baseUrl, token, context, openclawBin }) {
  if (!context?.kind || !context?.id || !context?.bin || !openclawBin) {
    throw new Error("OpenClaw remote install requires a discovered remote context and OpenClaw-like CLI path.");
  }
  const url = `${await remoteClientBaseUrl(context, baseUrl)}/mcp`;
  const config = {
    type: "http",
    url,
    headers: {
      "X-Pact-Api-Key": token
    },
    timeout: HTTP_TIMEOUT_MS,
    enabled: true
  };
  await runRemoteLinuxCommand(context, [openclawBin, "mcp", "set", MCP_SERVER_NAME, JSON.stringify(config)]);
  const show = await runRemoteLinuxCommand(context, [openclawBin, "mcp", "show", MCP_SERVER_NAME]);
  return {
    installMode: `openclaw-${context.kind}-mcp-cli`,
    remote: remoteContextLabel(context),
    url,
    mcpShowHasPact: show.stdout.includes(MCP_SERVER_NAME) || show.stdout.includes(url)
  };
}

async function installHermes({ baseUrl, token, orbBin, vmName, vmUser, hermesBin }) {
  if (!vmName || !vmUser || !hermesBin) {
    throw new Error("Hermes install requires a discovered or explicit OrbStack VM, user, and Hermes CLI path.");
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
  ], `${token}\n`, { timeoutMs: INSTALL_COMMAND_TIMEOUT_MS });
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
  await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, "bash", "-lc", enableScript]);
  await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, hermesBin, "mcp", "test", MCP_SERVER_NAME]);
  const list = await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, hermesBin, "mcp", "list"]);
  const listOutput = `${list.stdout}\n${list.stderr}`;
  return {
    installMode: "hermes-orbstack-mcp-cli",
    vm: vmName,
    vmUser,
    url,
    mcpListHasPact: listOutput.includes(MCP_SERVER_NAME),
    mcpListEnabled: listOutput.includes("enabled")
  };
}

async function installHermesRemote({ baseUrl, token, context, hermesBin }) {
  if (!context?.kind || !context?.id || !context?.bin || !hermesBin) {
    throw new Error("Hermes remote install requires a discovered remote context and Hermes CLI path.");
  }
  const url = `${await remoteClientBaseUrl(context, baseUrl)}/mcp`;
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
  const install = await remoteLinuxShellWithInput(context, script, `${token}\n`, {
    HERMES_BIN: hermesBin,
    PACT_URL: url
  });
  if (!install.ok) {
    throw new Error(`Hermes remote install failed in ${remoteContextLabel(context)}: ${install.stderr || install.stdout}`);
  }
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
  await remoteLinuxShell(context, enableScript, { timeoutMs: REMOTE_SCAN_COMMAND_TIMEOUT_MS });
  await runRemoteLinuxCommand(context, [hermesBin, "mcp", "test", MCP_SERVER_NAME]);
  const list = await runRemoteLinuxCommand(context, [hermesBin, "mcp", "list"]);
  const listOutput = `${list.stdout}\n${list.stderr}`;
  return {
    installMode: `hermes-${context.kind}-mcp-cli`,
    remote: remoteContextLabel(context),
    url,
    mcpListHasPact: listOutput.includes(MCP_SERVER_NAME),
    mcpListEnabled: listOutput.includes("enabled")
  };
}

function buildDeviceHubManifest({
  baseUrl,
  targets,
  codex,
  marketplaceRoot,
  codexPluginRoot,
  tokenEnv = DEFAULT_TOKEN_ENV,
  discoveryPath = discoveryRegistryPath()
}) {
  const parsed = new URL(baseUrl);
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  const mcpUrl = `${baseUrl}/mcp`;
  const vmMcpUrl = `${parsed.protocol}//host.orb.internal:${port}/mcp`;
  const env = deviceDiscoveryEnv({ baseUrl, primaryPath: discoveryPath });
  const packageExec = `npx ${packageJson.name}@${packageJson.version}`;
  const urlArgs = ` --url ${shellQuote(baseUrl)}`;
  const tokenEnvArgs = tokenEnv && tokenEnv !== DEFAULT_TOKEN_ENV ? ` --token-env ${shellQuote(tokenEnv)}` : "";
  const contextArgs = `${urlArgs}${tokenEnvArgs}`;
  const githubOneLineCommand = githubOneLineMcpInstallCommand();
  const githubOneLineCommandZhCN = githubOneLineMcpInstallCommand(BOOTSTRAP_INSTALL_SCRIPT_ZH_CN);
  const githubOneLineInstallCommand = `${githubOneLineCommand} --${contextArgs}`;
  const githubOneLineInstallCommandZhCN = `${githubOneLineCommandZhCN} --${contextArgs}`;
  const githubOneLineClientInstallJsonCommand = `${githubOneLineCommand} -- --target <client>${contextArgs} --json`;
  const githubOneLineClientInstallJsonCommandZhCN = `${githubOneLineCommandZhCN} -- --target <client>${contextArgs} --json`;
  const githubOneLineAutoInstallCommand = `${githubOneLineCommand} -- --target auto${contextArgs} --json`;
  const githubOneLineAutoInstallCommandZhCN = `${githubOneLineCommandZhCN} -- --target auto${contextArgs} --json`;
  const githubOneLinePriorityInstallCommand = `${githubOneLineCommand} -- --target ${PRIORITY_INSTALL_TARGET}${contextArgs} --json`;
  const githubOneLinePriorityInstallCommandZhCN = `${githubOneLineCommandZhCN} -- --target ${PRIORITY_INSTALL_TARGET}${contextArgs} --json`;
  const discoverCommand = `${packageExec} discover-local${urlArgs} --json`;
  const interactiveInstallCommand = `${packageExec} install${urlArgs}${tokenEnvArgs}`;
  const clientInstallJsonCommand = `${packageExec} install --target <client>${urlArgs}${tokenEnvArgs} --json`;
  const autoInstallCommand = `${packageExec} install --target auto${urlArgs}${tokenEnvArgs} --json`;
  const priorityInstallCommand = `${packageExec} install --target ${PRIORITY_INSTALL_TARGET}${urlArgs}${tokenEnvArgs} --json`;
  const scanCommand = `${packageExec} scan${urlArgs}${tokenEnvArgs} --json`;
  const doctorCommand = `${packageExec} doctor${urlArgs}${tokenEnvArgs} --json`;
  const codexInstallCommand = `${packageExec} install --target codex${urlArgs}${tokenEnvArgs}`;
  const codexManifest = codex
    ? {
        ...codex,
        tokenEnv,
        installCommand: codexInstallCommand
      }
    : codexPluginRoot
    ? {
        plugin: `${PLUGIN_NAME}@${MARKETPLACE_NAME}`,
        marketplaceRoot,
        pluginRoot: codexPluginRoot,
        tokenEnv,
        installCommand: codexInstallCommand
      }
    : null;
  return {
    version: "v0.0.1:mcp:device-hub-1",
    schemaVersion: "v0.0.1:mcp:device-hub-1",
    generatedAt: new Date().toISOString(),
    discovery: {
      strategy: "shared-device-hub",
      localEntry: {
        type: "pact-mcp-discover-local",
        command: discoverCommand,
        registryFile: discoveryPath
      },
      preferredHttpDiscoveryUrl: `${baseUrl}/.well-known/pact/mcp.json`,
      preferredApiDiscoveryUrl: `${baseUrl}/api/mcp/discovery`,
      registryFile: discoveryPath,
      localFiles: [discoveryPath],
      env,
      lookupOrder: [
        "pact-mcp discover-local --json",
        "PACT_MCP_URL",
        "PACT_MCP_DISCOVERY_URL",
        "PACT_MCP_DISCOVERY_FILE",
        "signed local port scan"
      ]
    },
    servers: {
      [MCP_SERVER_NAME]: {
        name: "Pact",
        transport: "streamable-http",
        httpUrl: mcpUrl,
        vmHttpUrl: vmMcpUrl,
        discoveryUrl: `${baseUrl}/.well-known/pact/mcp.json`,
        apiDiscoveryUrl: `${baseUrl}/api/mcp/discovery`,
        stableToolName: MCP_STABLE_TOOL_NAME,
        sharedHub: sharedHubContract({ mcpUrl, vmMcpUrl }),
        connector: {
          packageName: packageJson.name,
          packageVersion: packageJson.version,
          registerCommand: `${packageExec} register${urlArgs}${tokenEnvArgs}`,
          interactiveInstallCommand,
          githubOneLineCommand,
          githubOneLineCommandZhCN,
          githubOneLineInstallCommand,
          githubOneLineInstallCommandZhCN,
          githubOneLineClientInstallJsonCommand,
          githubOneLineClientInstallJsonCommandZhCN,
          githubOneLineAutoInstallCommand,
          githubOneLineAutoInstallCommandZhCN,
          githubOneLinePriorityInstallCommand,
          githubOneLinePriorityInstallCommandZhCN,
          oneCommandInstall: githubOneLineInstallCommand,
          oneCommandInstallZhCN: githubOneLineInstallCommandZhCN,
          oneCommandClientInstallJson: githubOneLineClientInstallJsonCommand,
          oneCommandClientInstallJsonZhCN: githubOneLineClientInstallJsonCommandZhCN,
          oneCommandAutoInstall: githubOneLineAutoInstallCommand,
          oneCommandAutoInstallZhCN: githubOneLineAutoInstallCommandZhCN,
          oneCommandPriorityInstall: githubOneLinePriorityInstallCommand,
          oneCommandPriorityInstallZhCN: githubOneLinePriorityInstallCommandZhCN,
          autoInstallCommand,
          priorityInstallCommand,
          priorityTargets: [...PRIORITY_INSTALL_TARGETS],
          supportedTargets: [...SUPPORTED_TARGETS],
          supportedTargetDetails: supportedTargetDetails(),
          installCommand: `${packageExec} install --target <client>${urlArgs}${tokenEnvArgs}`,
          clientInstallJsonCommand,
          uninstallCommand: `${packageExec} uninstall --target <client>${urlArgs}`,
          discoverCommand,
          scanCommand,
          doctorCommand
        },
        upgrade: {
          listChanged: true,
          notification: "notifications/tools/list_changed",
          reinstallCommand: githubOneLineInstallCommand,
          reinstallCommandZhCN: githubOneLineInstallCommandZhCN,
          clientReinstallJsonCommand: githubOneLineClientInstallJsonCommand,
          clientReinstallJsonCommandZhCN: githubOneLineClientInstallJsonCommandZhCN,
          agentReinstallCommand: githubOneLineAutoInstallCommand,
          agentReinstallCommandZhCN: githubOneLineAutoInstallCommandZhCN,
          priorityAgentReinstallCommand: githubOneLinePriorityInstallCommand,
          priorityAgentReinstallCommandZhCN: githubOneLinePriorityInstallCommandZhCN,
          oneCommandReinstall: githubOneLineInstallCommand,
          oneCommandReinstallZhCN: githubOneLineInstallCommandZhCN,
          oneCommandClientReinstallJson: githubOneLineClientInstallJsonCommand,
          oneCommandClientReinstallJsonZhCN: githubOneLineClientInstallJsonCommandZhCN,
          oneCommandAgentReinstall: githubOneLineAutoInstallCommand,
          oneCommandAgentReinstallZhCN: githubOneLineAutoInstallCommandZhCN,
          oneCommandPriorityAgentReinstall: githubOneLinePriorityInstallCommand,
          oneCommandPriorityAgentReinstallZhCN: githubOneLinePriorityInstallCommandZhCN,
          priorityTargets: [...PRIORITY_INSTALL_TARGETS]
        },
        auth: {
          type: "auto-local-grant-or-provided-token",
          acceptedHeaders: ["Authorization: Bearer <token>", "X-Pact-Api-Key"],
          tokenEnv
        },
        codex: codexManifest,
        targets
      }
    }
  };
}

async function publishDeviceHubManifest({ baseUrl, targets, codex, marketplaceRoot = "", codexPluginRoot = "", tokenEnv = DEFAULT_TOKEN_ENV, publishEnv = true, discoveryPath = discoveryRegistryPath() }) {
  const manifest = buildDeviceHubManifest({ baseUrl, targets, codex, marketplaceRoot, codexPluginRoot, tokenEnv, discoveryPath });
  await writeJson(discoveryPath, manifest);
  const envPublished = publishEnv ? await publishLaunchctlEnv(manifest.discovery.env) : false;
  return {
    primaryPath: discoveryPath,
    paths: [discoveryPath],
    env: manifest.discovery.env,
    envPublished,
    manifest
  };
}

async function uninstallCodex({ tokenEnv, codexBin, marketplaceRoot }) {
  const removeMcp = await runInstallCommand(codexBin, ["mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  const removePlugin = await runInstallCommand(codexBin, ["plugin", "remove", `${PLUGIN_NAME}@${MARKETPLACE_NAME}`], { allowFailure: true });
  await runInstallCommand("launchctl", ["unsetenv", tokenEnv], { allowFailure: true });
  const pluginRoot = path.join(marketplaceRoot, "plugins", PLUGIN_NAME);
  await removeDirIfExists(pluginRoot);
  const marketplaceBackupPath = await removeCodexMarketplacePlugin({ marketplaceRoot });
  return {
    uninstallMode: "codex-release-plugin-and-mcp-cli",
    removedMcp: removeMcp.ok,
    removedPlugin: removePlugin.ok,
    pluginRoot,
    marketplaceBackupPath
  };
}

async function uninstallCodexOrb({ orbBin, vmName, vmUser, codexBin }) {
  if (!vmName || !vmUser || !codexBin) {
    throw new Error("Codex VM uninstall requires a discovered or explicit OrbStack VM, user, and codex CLI path.");
  }
  const remove = await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, codexBin, "mcp", "remove", MCP_SERVER_NAME], {
    allowFailure: true
  });
  const get = await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, codexBin, "mcp", "get", MCP_SERVER_NAME], {
    allowFailure: true
  });
  return {
    uninstallMode: "codex-orbstack-mcp-cli",
    vm: vmName,
    vmUser,
    removedMcp: remove.ok,
    mcpGetHasPact: get.ok && mcpOutputHasPact(get)
  };
}

async function uninstallCodexRemote({ context, codexBin }) {
  if (!context?.kind || !context?.id || !context?.bin || !codexBin) {
    throw new Error("Codex remote uninstall requires a discovered remote context and codex CLI path.");
  }
  const remove = await runRemoteLinuxCommand(context, [codexBin, "mcp", "remove", MCP_SERVER_NAME], {
    allowFailure: true
  });
  const get = await runRemoteLinuxCommand(context, [codexBin, "mcp", "get", MCP_SERVER_NAME], {
    allowFailure: true
  });
  return {
    uninstallMode: `codex-${context.kind}-mcp-cli`,
    remote: remoteContextLabel(context),
    removedMcp: remove.ok,
    mcpGetHasPact: get.ok && mcpOutputHasPact(get)
  };
}

async function uninstallClaudeCode({ claudeBin }) {
  const remove = await runInstallCommand(claudeBin, ["mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  return {
    uninstallMode: "claude-code-release-mcp-cli",
    removedMcp: remove.ok
  };
}

async function uninstallClaudeCodeOrb({ orbBin, vmName, vmUser, claudeBin }) {
  if (!vmName || !vmUser || !claudeBin) {
    throw new Error("Claude Code VM uninstall requires a discovered or explicit OrbStack VM, user, and claude CLI path.");
  }
  const remove = await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, claudeBin, "mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  const get = await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, claudeBin, "mcp", "get", MCP_SERVER_NAME], { allowFailure: true });
  return {
    uninstallMode: "claude-code-orbstack-mcp-cli",
    vm: vmName,
    vmUser,
    removedMcp: remove.ok,
    mcpGetHasPact: get.ok && get.stdout.includes(MCP_SERVER_NAME)
  };
}

async function uninstallClaudeCodeRemote({ context, claudeBin }) {
  if (!context?.kind || !context?.id || !context?.bin || !claudeBin) {
    throw new Error("Claude Code remote uninstall requires a discovered remote context and claude CLI path.");
  }
  const remove = await runRemoteLinuxCommand(context, [claudeBin, "mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  const get = await runRemoteLinuxCommand(context, [claudeBin, "mcp", "get", MCP_SERVER_NAME], { allowFailure: true });
  return {
    uninstallMode: `claude-code-${context.kind}-mcp-cli`,
    remote: remoteContextLabel(context),
    removedMcp: remove.ok,
    mcpGetHasPact: get.ok && get.stdout.includes(MCP_SERVER_NAME)
  };
}

async function removeNamedMcpEntry({ filePath, rootKey }) {
  const config = await readJson(filePath, null);
  if (!config?.[rootKey]?.[MCP_SERVER_NAME]) {
    return {
      removed: false,
      backupPath: ""
    };
  }
  const backupPath = await backupIfExists(filePath);
  delete config[rootKey][MCP_SERVER_NAME];
  await writeJson(filePath, config);
  return {
    removed: true,
    backupPath
  };
}

async function uninstallKilo({ kiloConfigPath, kiloBin }) {
  const removed = await removeNamedMcpEntry({ filePath: kiloConfigPath, rootKey: "mcp" });
  const list = await runInstallCommand(kiloBin, ["mcp", "list"], { allowFailure: true });
  return {
    uninstallMode: "kilo-release-global-kilo-json",
    configPath: kiloConfigPath,
    backupPath: removed.backupPath,
    removedConfigEntry: removed.removed,
    mcpListHasPact: list.stdout.includes(MCP_SERVER_NAME) || list.stderr.includes(MCP_SERVER_NAME)
  };
}

function kiloUninstallScript() {
  return [
    "set -e",
    "node <<'NODE'",
    "const fs = require('fs');",
    "const os = require('os');",
    "const path = require('path');",
    "const filePath = path.join(os.homedir(), '.config', 'kilo', 'kilo.json');",
    "let config = {};",
    "try { config = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { process.exit(0); }",
    "if (config.mcp && Object.prototype.hasOwnProperty.call(config.mcp, 'pact')) {",
    "  delete config.mcp.pact;",
    "  fs.mkdirSync(path.dirname(filePath), { recursive: true });",
    "  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\\n`);",
    "}",
    "NODE",
    "\"$KILO_BIN\" mcp list >/dev/null 2>&1 || true"
  ].join("\n");
}

async function uninstallKiloOrb({ orbBin, vmName, vmUser, kiloBin }) {
  if (!vmName || !vmUser || !kiloBin) {
    throw new Error("Kilo VM uninstall requires a discovered or explicit OrbStack VM, user, and kilo CLI path.");
  }
  const remove = await runInstallCommand(orbBin, [
    "-m",
    vmName,
    "-u",
    vmUser,
    "env",
    `KILO_BIN=${kiloBin}`,
    "bash",
    "-lc",
    kiloUninstallScript()
  ], { allowFailure: true });
  return {
    uninstallMode: "kilo-orbstack-global-kilo-json",
    vm: vmName,
    vmUser,
    configPath: "~/.config/kilo/kilo.json",
    removedConfigEntry: remove.ok
  };
}

async function uninstallKiloRemote({ context, kiloBin }) {
  if (!context?.kind || !context?.id || !context?.bin || !kiloBin) {
    throw new Error("Kilo remote uninstall requires a discovered remote context and kilo CLI path.");
  }
  const remove = await remoteLinuxShellWithInput(context, kiloUninstallScript(), "", {
    KILO_BIN: kiloBin
  });
  return {
    uninstallMode: `kilo-${context.kind}-global-kilo-json`,
    remote: remoteContextLabel(context),
    configPath: "~/.config/kilo/kilo.json",
    removedConfigEntry: remove.ok
  };
}

async function uninstallCopilot({ copilotBin }) {
  const remove = await runInstallCommand(copilotBin, ["mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  return {
    uninstallMode: "copilot-release-mcp-cli",
    removedMcp: remove.ok
  };
}

async function uninstallCopilotOrb({ orbBin, vmName, vmUser, copilotBin }) {
  if (!vmName || !vmUser || !copilotBin) {
    throw new Error("Copilot VM uninstall requires a discovered or explicit OrbStack VM, user, and copilot CLI path.");
  }
  const remove = await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, copilotBin, "mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  const get = await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, copilotBin, "mcp", "get", MCP_SERVER_NAME], { allowFailure: true });
  return {
    uninstallMode: "copilot-orbstack-mcp-cli",
    vm: vmName,
    vmUser,
    removedMcp: remove.ok,
    mcpGetHasPact: get.ok && get.stdout.includes(MCP_SERVER_NAME)
  };
}

async function uninstallCopilotRemote({ context, copilotBin }) {
  if (!context?.kind || !context?.id || !context?.bin || !copilotBin) {
    throw new Error("Copilot remote uninstall requires a discovered remote context and copilot CLI path.");
  }
  const remove = await runRemoteLinuxCommand(context, [copilotBin, "mcp", "remove", MCP_SERVER_NAME], { allowFailure: true });
  const get = await runRemoteLinuxCommand(context, [copilotBin, "mcp", "get", MCP_SERVER_NAME], { allowFailure: true });
  return {
    uninstallMode: `copilot-${context.kind}-mcp-cli`,
    remote: remoteContextLabel(context),
    removedMcp: remove.ok,
    mcpGetHasPact: get.ok && get.stdout.includes(MCP_SERVER_NAME)
  };
}

async function uninstallAntigravity({ configPath }) {
  return uninstallMcpServersJsonConfig({
    configPath,
    uninstallMode: "antigravity-release-mcp-config"
  });
}

async function uninstallMcpServersJsonConfig({ configPath, uninstallMode }) {
  const removed = await removeNamedMcpEntry({ filePath: configPath, rootKey: "mcpServers" });
  return {
    uninstallMode,
    configPath,
    backupPath: removed.backupPath,
    removedConfigEntry: removed.removed
  };
}

async function uninstallOpenCode({ configPath }) {
  const removed = await removeNamedMcpEntry({ filePath: configPath, rootKey: "mcp" });
  return {
    uninstallMode: "opencode-release-mcp-config",
    configPath,
    backupPath: removed.backupPath,
    removedConfigEntry: removed.removed
  };
}

async function uninstallOpenCodeOrb({ orbBin, vmName, vmUser }) {
  if (!vmName || !vmUser) {
    throw new Error("OpenCode VM uninstall requires a discovered or explicit OrbStack VM and user.");
  }
  const result = await run(orbBin, ["-m", vmName, "-u", vmUser, "bash", "-lc", openCodeRemoteUninstallScript()], {
    allowFailure: true
  });
  return {
    uninstallMode: "opencode-orbstack-mcp-config",
    vm: vmName,
    vmUser,
    removedConfigEntry: result.ok && /removed/.test(result.stdout)
  };
}

async function uninstallOpenCodeRemote({ context }) {
  if (!context?.kind || !context?.id || !context?.bin) {
    throw new Error("OpenCode remote uninstall requires a discovered remote context.");
  }
  const result = await remoteLinuxShell(context, openCodeRemoteUninstallScript(), { timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
  return {
    uninstallMode: `opencode-${context.kind}-mcp-config`,
    remote: remoteContextLabel(context),
    removedConfigEntry: result.ok && /removed/.test(result.stdout)
  };
}

async function uninstallOpenClaw({ orbBin, vmName, vmUser, openclawBin }) {
  if (!openclawBin) {
    throw new Error("OpenClaw uninstall requires a discovered or explicit OpenClaw-like CLI path.");
  }
  const isOrb = Boolean(vmName || vmUser);
  if (isOrb && (!vmName || !vmUser)) {
    throw new Error("OpenClaw VM uninstall requires both OrbStack VM and user.");
  }
  const remove = isOrb
    ? await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, openclawBin, "mcp", "unset", MCP_SERVER_NAME], { allowFailure: true })
    : await runInstallCommand(openclawBin, ["mcp", "unset", MCP_SERVER_NAME], { allowFailure: true });
  const show = isOrb
    ? await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, openclawBin, "mcp", "show", MCP_SERVER_NAME], { allowFailure: true })
    : await runInstallCommand(openclawBin, ["mcp", "show", MCP_SERVER_NAME], { allowFailure: true });
  return {
    uninstallMode: isOrb ? "openclaw-orbstack-mcp-cli" : "openclaw-release-mcp-cli",
    vm: vmName,
    vmUser,
    removedMcp: remove.ok,
    mcpShowHasPact: show.ok && show.stdout.includes(MCP_SERVER_NAME)
  };
}

async function uninstallOpenClawRemote({ context, openclawBin }) {
  if (!context?.kind || !context?.id || !context?.bin || !openclawBin) {
    throw new Error("OpenClaw remote uninstall requires a discovered remote context and OpenClaw-like CLI path.");
  }
  const remove = await runRemoteLinuxCommand(context, [openclawBin, "mcp", "unset", MCP_SERVER_NAME], { allowFailure: true });
  const show = await runRemoteLinuxCommand(context, [openclawBin, "mcp", "show", MCP_SERVER_NAME], { allowFailure: true });
  return {
    uninstallMode: `openclaw-${context.kind}-mcp-cli`,
    remote: remoteContextLabel(context),
    removedMcp: remove.ok,
    mcpShowHasPact: show.ok && show.stdout.includes(MCP_SERVER_NAME)
  };
}

async function uninstallHermes({ orbBin, vmName, vmUser, hermesBin }) {
  if (!vmName || !vmUser || !hermesBin) {
    throw new Error("Hermes uninstall requires a discovered or explicit OrbStack VM, user, and Hermes CLI path.");
  }
  const script = [
    "set -e",
    "printf 'y\\n' | \"$HERMES_BIN\" mcp remove pact >/dev/null 2>&1 || true",
    "if [ -d \"$HOME/.hermes/hermes-agent\" ]; then",
    "  cd \"$HOME/.hermes/hermes-agent\"",
    "  if [ -f venv/bin/activate ]; then . venv/bin/activate; fi",
    "  python - <<'PY'",
    "from hermes_cli.config import load_config, save_config",
    "cfg = load_config()",
    "cfg.get('mcp_servers', {}).pop('pact', None)",
    "save_config(cfg)",
    "PY",
    "fi"
  ].join("\n");
  const remove = await runInstallCommand(orbBin, [
    "-m",
    vmName,
    "-u",
    vmUser,
    "env",
    `HERMES_BIN=${hermesBin}`,
    "bash",
    "-lc",
    script
  ], { allowFailure: true });
  const list = await runInstallCommand(orbBin, ["-m", vmName, "-u", vmUser, hermesBin, "mcp", "list"], { allowFailure: true });
  const listOutput = `${list.stdout}\n${list.stderr}`;
  return {
    uninstallMode: "hermes-orbstack-mcp-cli",
    vm: vmName,
    vmUser,
    removedMcp: remove.ok,
    mcpListHasPact: listOutput.includes(MCP_SERVER_NAME)
  };
}

async function uninstallHermesRemote({ context, hermesBin }) {
  if (!context?.kind || !context?.id || !context?.bin || !hermesBin) {
    throw new Error("Hermes remote uninstall requires a discovered remote context and Hermes CLI path.");
  }
  const script = [
    "set -e",
    "printf 'y\\n' | \"$HERMES_BIN\" mcp remove pact >/dev/null 2>&1 || true",
    "if [ -d \"$HOME/.hermes/hermes-agent\" ]; then",
    "  cd \"$HOME/.hermes/hermes-agent\"",
    "  if [ -f venv/bin/activate ]; then . venv/bin/activate; fi",
    "  python - <<'PY'",
    "from hermes_cli.config import load_config, save_config",
    "cfg = load_config()",
    "cfg.get('mcp_servers', {}).pop('pact', None)",
    "save_config(cfg)",
    "PY",
    "fi"
  ].join("\n");
  const remove = await remoteLinuxShellWithInput(context, script, "", { HERMES_BIN: hermesBin });
  const list = await runRemoteLinuxCommand(context, [hermesBin, "mcp", "list"], { allowFailure: true });
  const listOutput = `${list.stdout}\n${list.stderr}`;
  return {
    uninstallMode: `hermes-${context.kind}-mcp-cli`,
    remote: remoteContextLabel(context),
    removedMcp: remove.ok,
    mcpListHasPact: listOutput.includes(MCP_SERVER_NAME)
  };
}

async function writeDeviceDiscovery({ baseUrl, marketplaceRoot, codexPluginRoot, installed, token, tokenEnv = DEFAULT_TOKEN_ENV, publishEnv = true, discoveryPath = discoveryRegistryPath() }) {
  const manifestPath = discoveryPath;
  const existingManifest = await readJson(manifestPath, {});
  const existingServer = existingManifest?.servers?.[MCP_SERVER_NAME] || {};
  const existingTargets = existingServer.targets || {};
  const targetStatuses = Object.fromEntries(SUPPORTED_TARGETS.map((target) => [
    target,
    installed[target]
      ? installed[target].ok === false
        ? {
            installMode: installed[target].installMode || targetInstallMode(target),
            status: "failed",
            error: installed[target].error || "Install failed."
          }
        : {
          installMode: installed[target].installMode,
          status: "installed",
          tokenPrefix: redactToken(token)
        }
      : existingTargets[target] || {
          installMode: "supported",
          status: "not-installed"
        }
  ]));
  const published = await publishDeviceHubManifest({
    baseUrl,
    targets: targetStatuses,
    codex: normalizeCodexDiscovery(existingServer.codex),
    marketplaceRoot,
    codexPluginRoot,
    tokenEnv,
    publishEnv,
    discoveryPath: manifestPath
  });
  return published.primaryPath;
}

async function writeDeviceUninstall({ baseUrl, uninstalled, tokenEnv = DEFAULT_TOKEN_ENV, publishEnv = true, discoveryPath = discoveryRegistryPath() }) {
  const manifestPath = discoveryPath;
  const existingManifest = await readJson(manifestPath, {});
  const existingServer = existingManifest?.servers?.[MCP_SERVER_NAME] || {};
  const effectiveTokenEnv = tokenEnv || existingManifestTokenEnv(existingServer);
  const existingTargets = existingServer.targets || {};
  const targets = Object.fromEntries(SUPPORTED_TARGETS.map((target) => [
    target,
    uninstalled[target]
      ? uninstalled[target].ok === false
        ? {
            installMode: uninstalled[target].uninstallMode || targetInstallMode(target),
            status: "failed",
            error: uninstalled[target].error || "Uninstall failed."
          }
        : {
          installMode: uninstalled[target].uninstallMode,
          status: "not-installed"
        }
      : existingTargets[target] || {
          installMode: "supported",
          status: "not-installed"
        }
  ]));
  const published = await publishDeviceHubManifest({
    baseUrl,
    targets,
    codex: normalizeCodexDiscovery(existingServer.codex),
    tokenEnv: effectiveTokenEnv,
    publishEnv,
    discoveryPath: manifestPath
  });
  return published.primaryPath;
}

function defaultTargetStatuses(existingTargets = {}) {
  return Object.fromEntries(SUPPORTED_TARGETS.map((target) => [
    target,
    existingTargets[target] || {
      installMode: "supported",
      status: "not-installed"
    }
  ]));
}

function profileFromDiscovery({ name, discovered }) {
  const baseUrl = discovered.baseUrl;
  return {
    name,
    baseUrl,
    mcpUrl: `${baseUrl}/mcp`,
    discoveryUrl: `${baseUrl}/api/mcp/discovery`,
    identityKeyId: discovered.handshake?.payload?.identity?.keyId || "",
    serverId: discovered.discovery?.serverId || discovered.handshake?.payload?.server?.serverId || "",
    serverVersion: discovered.discovery?.serverVersion || discovered.handshake?.payload?.server?.serverVersion || "",
    interfaceVersion: discovered.discovery?.interfaceVersion || MCP_INTERFACE_VERSION,
    stableToolName: discovered.discovery?.stableToolName || MCP_STABLE_TOOL_NAME,
    updatedAt: new Date().toISOString()
  };
}

function normalizeCodexDiscovery(codex) {
  if (!codex) {
    return null;
  }
  return {
    ...codex,
    installCommand: `npx ${packageJson.name}@${packageJson.version} install --target codex`
  };
}

function existingManifestTokenEnv(server = {}) {
  return String(server.auth?.tokenEnv || server.codex?.tokenEnv || DEFAULT_TOKEN_ENV);
}

async function writeServerConfigProfile({ options, name = "default", discovered, publishEnv = true }) {
  const discoveryPath = discoveryRegistryPath(options);
  const existingManifest = await readJson(discoveryPath, {});
  const existingServer = existingManifest?.servers?.[MCP_SERVER_NAME] || {};
  const tokenEnv = Object.hasOwn(options, "token-env")
    ? String(option(options, "token-env", DEFAULT_TOKEN_ENV))
    : existingManifestTokenEnv(existingServer);
  const published = await publishDeviceHubManifest({
    baseUrl: discovered.baseUrl,
    targets: defaultTargetStatuses(existingServer.targets || {}),
    codex: normalizeCodexDiscovery(existingServer.codex),
    tokenEnv,
    publishEnv,
    discoveryPath
  });
  const manifest = await readJson(discoveryPath, {});
  manifest.serverConfig = {
    ...(manifest.serverConfig || {}),
    activeName: name,
    profiles: {
      ...(existingManifest.serverConfig?.profiles || {}),
      [name]: profileFromDiscovery({ name, discovered })
    },
    updatedAt: new Date().toISOString()
  };
  await writeJson(discoveryPath, manifest);
  return {
    ok: true,
    path: published.primaryPath,
    activeName: name,
    profile: manifest.serverConfig.profiles[name],
    tokenEnv
  };
}

async function resetServerConfig({ options, publishEnv = true }) {
  const discoveryPath = discoveryRegistryPath(options);
  const existingManifest = await readJson(discoveryPath, {});
  const resetManifest = {
    version: "v0.0.1:mcp:device-hub-1",
    schemaVersion: "v0.0.1:mcp:device-hub-1",
    generatedAt: new Date().toISOString(),
    discovery: {
      strategy: "shared-device-hub",
      localEntry: {
        type: "pact-mcp-discover-local",
        command: `npx ${packageJson.name}@${packageJson.version} discover-local --json`,
        registryFile: discoveryPath
      },
      registryFile: discoveryPath,
      localFiles: [discoveryPath],
      env: {},
      lookupOrder: [
        "pact-mcp discover-local --json",
        "signed local port scan"
      ]
    },
    servers: {},
    serverConfig: {
      activeName: "",
      profiles: {},
      updatedAt: new Date().toISOString(),
      previousActiveName: existingManifest?.serverConfig?.activeName || ""
    }
  };
  await writeJson(discoveryPath, resetManifest);
  if (publishEnv && process.platform === "darwin") {
    await run("launchctl", ["unsetenv", PACT_MCP_URL_ENV], { allowFailure: true });
    await run("launchctl", ["unsetenv", PACT_MCP_DISCOVERY_URL_ENV], { allowFailure: true });
    await run("launchctl", ["unsetenv", PACT_MCP_DISCOVERY_FILE_ENV], { allowFailure: true });
  }
  return {
    ok: true,
    path: discoveryPath,
    reset: true
  };
}

async function serverConfigCommand(options) {
  const discoveryPath = discoveryRegistryPath(options);
  if (options.reset) {
    return resetServerConfig({ options, publishEnv: !options["no-env"] });
  }
  if (options.list) {
    const manifest = await readJson(discoveryPath, {});
    return {
      ok: true,
      path: discoveryPath,
      activeName: manifest?.serverConfig?.activeName || "",
      profiles: manifest?.serverConfig?.profiles || {},
      currentServer: manifest?.servers?.[MCP_SERVER_NAME] || null
    };
  }
  if (options.set) {
    const url = explicitBaseUrl(options);
    if (!url) {
      throw new Error("server-config --set requires --url.");
    }
    const discovered = await discoverPactHub({ ...options, url });
    if (!discovered.ok) {
      throw new Error(`Failed to verify Pact MCP server at ${url}: ${discovered.reason}`);
    }
    return writeServerConfigProfile({
      options,
      name: String(option(options, "name", "default")).trim() || "default",
      discovered,
      publishEnv: !options["no-env"]
    });
  }
  if (options.switch) {
    const name = String(options.switch || "").trim();
    const manifest = await readJson(discoveryPath, {});
    const profile = manifest?.serverConfig?.profiles?.[name];
    if (!profile?.baseUrl) {
      throw new Error(`No Pact MCP server profile named ${name}.`);
    }
    const discovered = await discoverPactHub({ ...options, url: profile.baseUrl });
    if (!discovered.ok) {
      throw new Error(`Failed to verify Pact MCP server profile ${name}: ${discovered.reason}`);
    }
    return writeServerConfigProfile({
      options,
      name,
      discovered,
      publishEnv: !options["no-env"]
    });
  }
  if (options.refresh) {
    const manifest = await readJson(discoveryPath, {});
    const activeName = manifest?.serverConfig?.activeName || "default";
    const discovered = await discoverPactHub(options);
    if (!discovered.ok) {
      throw new Error(discovered.reason);
    }
    return writeServerConfigProfile({
      options,
      name: activeName,
      discovered,
      publishEnv: !options["no-env"]
    });
  }
  return serverConfigCommand({ ...options, list: true });
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function detectHostOs() {
  if (process.platform === HOST_PLATFORM.MACOS || process.platform === HOST_PLATFORM.LINUX || process.platform === HOST_PLATFORM.WINDOWS) {
    return process.platform;
  }
  return process.platform;
}

function executableNamesForPlatform(command, platform = detectHostOs()) {
  const value = String(command || "").trim();
  if (!value) {
    return [];
  }
  if (platform !== "win32" || path.extname(value)) {
    return [value];
  }
  return [value, `${value}.exe`, `${value}.cmd`, `${value}.bat`, `${value}.ps1`];
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() || stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function nodeModulesBinProjectRoot(candidatePath, platform = detectHostOs()) {
  const normalized = String(candidatePath || "").replace(/\\/g, "/");
  const comparable = platform === "win32" ? normalized.toLowerCase() : normalized;
  const marker = "/node_modules/.bin/";
  const index = comparable.lastIndexOf(marker);
  if (index < 0) {
    return "";
  }
  return normalized.slice(0, index);
}

async function isProjectLocalPackageExecutable(candidatePath, platform = detectHostOs()) {
  const projectDir = nodeModulesBinProjectRoot(candidatePath, platform);
  if (!projectDir) {
    return false;
  }
  return fileExists(path.join(projectDir, "package.json"));
}

async function filterProjectLocalPackageExecutables(paths, platform = detectHostOs()) {
  const filtered = [];
  for (const item of paths) {
    if (!await isProjectLocalPackageExecutable(item, platform)) {
      filtered.push(item);
    }
  }
  return filtered;
}

async function collectExecutablePathsFromDirs(dirs, command, platform = detectHostOs()) {
  const paths = [];
  for (const dir of uniqueValues(dirs.map((item) => expandHomePath(item)))) {
    if (!dir || !await directoryExists(dir)) {
      continue;
    }
    for (const executableName of executableNamesForPlatform(command, platform)) {
      const candidate = path.join(dir, executableName);
      if (await fileExists(candidate)) {
        paths.push(candidate);
      }
    }
  }
  return paths;
}

async function detectPathCommandPaths(command, platform = detectHostOs()) {
  const value = String(command || "").trim();
  if (!value) {
    return [];
  }
  if (path.isAbsolute(value) || value.includes(path.sep)) {
    return await pathExists(value) ? [value] : [];
  }
  if (platform === "win32") {
    const names = executableNamesForPlatform(value, platform);
    const paths = [];
    for (const executableName of names) {
      const result = await run("where.exe", [executableName], { allowFailure: true, timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
      if (result.ok) {
        paths.push(...result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
      }
    }
    return uniqueResolvedLocalPaths(await filterProjectLocalPackageExecutables(paths, platform));
  }
  const result = await run("bash", [
    "-c",
    `type -a -p ${shellQuote(value)} 2>/dev/null | awk '!seen[$0]++'`
  ], { allowFailure: true, timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
  if (!result.ok) {
    return [];
  }
  const paths = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return uniqueResolvedLocalPaths(await filterProjectLocalPackageExecutables(paths, platform));
}

function packageSourceContext(platform = detectHostOs()) {
  const home = os.homedir();
  const userProfile = process.env.USERPROFILE || home;
  const appData = process.env.APPDATA || path.join(userProfile, "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA || path.join(userProfile, "AppData", "Local");
  return {
    platform,
    home,
    userProfile,
    appData,
    localAppData,
    programData: process.env.ProgramData || "C:\\ProgramData"
  };
}

function sourceValues(value, context) {
  const resolved = typeof value === "function" ? value(context) : value;
  if (Array.isArray(resolved)) {
    return resolved.flatMap((item) => sourceValues(item, context));
  }
  return resolved ? [resolved] : [];
}

function outputLines(stdout) {
  return String(stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function lastOutputLine(stdout) {
  return outputLines(stdout).at(-1) || "";
}

function packageSource(id, kind, options = {}) {
  return { id, kind, ...options };
}

const POSIX_PACKAGE_DIR_SOURCES = [
  packageSource("homebrew-prefix", PACKAGE_SOURCE_KIND.COMMAND_DIR, {
    executable: "brew",
    args: ["--prefix"],
    mapOutput: (stdout) => {
      const prefix = lastOutputLine(stdout);
      return prefix ? [path.join(prefix, "bin"), path.join(prefix, "sbin")] : [];
    }
  }),
  packageSource("posix-standard-dirs", PACKAGE_SOURCE_KIND.STATIC_DIRS, {
    dirs: [
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      "/opt/local/bin",
      "/opt/local/sbin",
      "/opt/sw/bin"
    ]
  }),
  packageSource("npm-prefix", PACKAGE_SOURCE_KIND.COMMAND_DIR, {
    executable: "npm",
    args: ["prefix", "-g"],
    mapOutput: (stdout) => {
      const prefix = lastOutputLine(stdout);
      return prefix ? path.join(prefix, "bin") : "";
    }
  }),
  packageSource("pnpm-bin", PACKAGE_SOURCE_KIND.COMMAND_DIR, { executable: "pnpm", args: ["bin", "-g"] }),
  packageSource("yarn-global-bin", PACKAGE_SOURCE_KIND.COMMAND_DIR, { executable: "yarn", args: ["global", "bin"] }),
  packageSource("bun-global-bin", PACKAGE_SOURCE_KIND.COMMAND_DIR, { executable: "bun", args: ["pm", "bin", "-g"] }),
  packageSource("uv-tool-bin", PACKAGE_SOURCE_KIND.COMMAND_DIR, { executable: "uv", args: ["tool", "dir", "--bin"] }),
  packageSource("pipx-bin", PACKAGE_SOURCE_KIND.COMMAND_DIR, { executable: "pipx", args: ["environment", "--value", "PIPX_BIN_DIR"] }),
  packageSource("nvm-node-versions", PACKAGE_SOURCE_KIND.VERSIONED_DIRS, {
    root: ({ home }) => path.join(process.env.NVM_DIR || path.join(home, ".nvm"), "versions", "node")
  }),
  packageSource("fnm-node-versions", PACKAGE_SOURCE_KIND.VERSIONED_DIRS, {
    root: ({ home }) => path.join(process.env.FNM_DIR || path.join(home, ".local", "share", "fnm"), "node-versions"),
    toDir: (root, version) => path.join(root, version, "installation", "bin")
  }),
  packageSource("nodenv-versions", PACKAGE_SOURCE_KIND.VERSIONED_DIRS, {
    root: ({ home }) => path.join(home, ".nodenv", "versions")
  }),
  packageSource("asdf-nodejs-versions", PACKAGE_SOURCE_KIND.VERSIONED_DIRS, {
    root: ({ home }) => path.join(home, ".asdf", "installs", "nodejs")
  }),
  packageSource("mise-node-versions", PACKAGE_SOURCE_KIND.VERSIONED_DIRS, {
    root: ({ home }) => [
      path.join(home, ".local", "share", "mise", "installs", "node"),
      path.join(home, ".local", "share", "mise", "installs", "nodejs"),
      path.join(home, ".mise", "installs", "node"),
      path.join(home, ".mise", "installs", "nodejs")
    ]
  }),
  packageSource("language-runtime-bins", PACKAGE_SOURCE_KIND.STATIC_DIRS, {
    dirs: ({ home }) => [
      path.join(process.env.VOLTA_HOME || path.join(home, ".volta"), "bin"),
      path.join(home, ".asdf", "shims"),
      path.join(home, ".local", "share", "mise", "shims"),
      path.join(home, ".mise", "shims"),
      path.join(home, ".nodenv", "shims"),
      path.join(process.env.CARGO_HOME || path.join(home, ".cargo"), "bin"),
      process.env.GOBIN || "",
      path.join(process.env.GOPATH || path.join(home, "go"), "bin"),
      path.join(process.env.DENO_INSTALL || path.join(home, ".deno"), "bin"),
      path.join(home, ".pixi", "bin"),
      path.join(home, ".pkgx", "bin"),
      path.join(home, ".rye", "shims"),
      path.join(home, "miniconda3", "bin"),
      path.join(home, "anaconda3", "bin"),
      path.join(home, ".conda", "bin"),
      path.join(home, ".local", "bin")
    ]
  })
];

const PLATFORM_PACKAGE_DIR_SOURCES = {
  [HOST_PLATFORM.MACOS]: POSIX_PACKAGE_DIR_SOURCES,
  [HOST_PLATFORM.LINUX]: [
    ...POSIX_PACKAGE_DIR_SOURCES,
    packageSource("linux-system-dirs", PACKAGE_SOURCE_KIND.STATIC_DIRS, {
      dirs: [
        "/usr/bin",
        "/usr/sbin",
        "/bin",
        "/sbin",
        "/opt/bin"
      ]
    }),
    packageSource("linux-desktop-package-dirs", PACKAGE_SOURCE_KIND.STATIC_DIRS, {
      dirs: ({ home }) => [
        "/snap/bin",
        "/var/lib/flatpak/exports/bin",
        path.join(home, ".local", "share", "flatpak", "exports", "bin")
      ]
    })
  ],
  [HOST_PLATFORM.WINDOWS]: [
    packageSource("npm-prefix", PACKAGE_SOURCE_KIND.COMMAND_DIR, { executable: "npm.cmd", args: ["prefix", "-g"] }),
    packageSource("pnpm-bin", PACKAGE_SOURCE_KIND.COMMAND_DIR, { executable: "pnpm.cmd", args: ["bin", "-g"] }),
    packageSource("yarn-global-bin", PACKAGE_SOURCE_KIND.COMMAND_DIR, { executable: "yarn.cmd", args: ["global", "bin"] }),
    packageSource("bun-global-bin", PACKAGE_SOURCE_KIND.COMMAND_DIR, { executable: "bun.exe", args: ["pm", "bin", "-g"] }),
    packageSource("pipx-bin", PACKAGE_SOURCE_KIND.COMMAND_DIR, { executable: "pipx.exe", args: ["environment", "--value", "PIPX_BIN_DIR"] }),
    packageSource("uv-tool-bin", PACKAGE_SOURCE_KIND.COMMAND_DIR, { executable: "uv.exe", args: ["tool", "dir", "--bin"] }),
    packageSource("windows-package-manager-dirs", PACKAGE_SOURCE_KIND.STATIC_DIRS, {
      dirs: ({ appData, localAppData, programData, userProfile }) => [
        path.join(userProfile, "scoop", "shims"),
        path.join(programData, "scoop", "shims"),
        process.env.SCOOP ? path.join(process.env.SCOOP, "shims") : "",
        path.join(process.env.ChocolateyInstall || path.join(programData, "chocolatey"), "bin"),
        path.join(localAppData, "Microsoft", "WinGet", "Links"),
        path.join(appData, "npm"),
        path.join(localAppData, "pnpm")
      ]
    }),
    packageSource("windows-node-version-managers", PACKAGE_SOURCE_KIND.STATIC_DIRS, {
      dirs: ({ appData, localAppData, userProfile }) => [
        process.env.NVM_SYMLINK || "",
        process.env.NVM_HOME || "",
        path.join(process.env.VOLTA_HOME || path.join(localAppData, "Volta"), "bin"),
        path.join(appData, "fnm"),
        path.join(appData, "fnm", "aliases", "default"),
        path.join(userProfile, ".nodenv", "shims"),
        path.join(userProfile, ".asdf", "shims"),
        path.join(localAppData, "mise", "shims"),
        path.join(userProfile, ".local", "share", "mise", "shims"),
        path.join(userProfile, ".mise", "shims")
      ]
    }),
    packageSource("windows-language-runtime-bins", PACKAGE_SOURCE_KIND.STATIC_DIRS, {
      dirs: ({ appData, localAppData, programData, userProfile }) => [
        path.join(userProfile, ".cargo", "bin"),
        process.env.GOBIN || "",
        path.join(process.env.GOPATH || path.join(userProfile, "go"), "bin"),
        path.join(process.env.DENO_INSTALL || path.join(userProfile, ".deno"), "bin"),
        path.join(userProfile, ".local", "bin"),
        path.join(userProfile, ".rye", "shims"),
        path.join(userProfile, ".pixi", "bin"),
        path.join(localAppData, "Programs", "Python", "Scripts"),
        path.join(appData, "Python", "Scripts"),
        path.join(programData, "chocolatey", "bin"),
        "C:\\Program Files\\nodejs",
        "C:\\Program Files (x86)\\Nodist\\bin"
      ]
    }),
    packageSource("fnm-node-versions", PACKAGE_SOURCE_KIND.VERSIONED_DIRS, {
      root: ({ appData }) => path.join(process.env.FNM_DIR || path.join(appData, "fnm"), "node-versions"),
      toDir: (root, version) => path.join(root, version, "installation")
    }),
    packageSource("nodenv-versions", PACKAGE_SOURCE_KIND.VERSIONED_DIRS, {
      root: ({ userProfile }) => path.join(userProfile, ".nodenv", "versions")
    }),
    packageSource("asdf-nodejs-versions", PACKAGE_SOURCE_KIND.VERSIONED_DIRS, {
      root: ({ userProfile }) => path.join(userProfile, ".asdf", "installs", "nodejs")
    }),
    packageSource("mise-node-versions", PACKAGE_SOURCE_KIND.VERSIONED_DIRS, {
      root: ({ localAppData }) => [
        path.join(localAppData, "mise", "installs", "node"),
        path.join(localAppData, "mise", "installs", "nodejs")
      ]
    })
  ]
};

const PLATFORM_PACKAGE_EXECUTABLE_PATH_SOURCES = {
  [HOST_PLATFORM.MACOS]: [],
  [HOST_PLATFORM.LINUX]: [],
  [HOST_PLATFORM.WINDOWS]: [
    packageSource("scoop-which", PACKAGE_SOURCE_KIND.COMMAND_PATHS, {
      executables: ["scoop.cmd", "scoop"],
      argsForCommand: (command) => ["which", command]
    })
  ]
};

async function scanStaticDirSource(source, context) {
  return sourceValues(source.dirs, context);
}

async function scanCommandDirSource(source, context) {
  const result = await run(source.executable, sourceValues(source.args, context), {
    allowFailure: true,
    timeoutMs: source.timeoutMs || SCAN_COMMAND_TIMEOUT_MS
  });
  if (!result.ok || !result.stdout.trim()) {
    return [];
  }
  if (source.mapOutput) {
    return sourceValues(source.mapOutput(result.stdout, context), context);
  }
  return [lastOutputLine(result.stdout)].filter(Boolean);
}

async function scanVersionedDirSource(source, context) {
  const dirs = [];
  const toDir = source.toDir || ((root, version) => path.join(root, version, "bin"));
  for (const root of sourceValues(source.root, context)) {
    if (!await directoryExists(root)) {
      continue;
    }
    const versions = await fs.readdir(root).catch(() => []);
    dirs.push(...versions.map((version) => toDir(root, version, context)));
  }
  return dirs;
}

const PACKAGE_SOURCE_SCANNERS = {
  [PACKAGE_SOURCE_KIND.STATIC_DIRS]: scanStaticDirSource,
  [PACKAGE_SOURCE_KIND.COMMAND_DIR]: scanCommandDirSource,
  [PACKAGE_SOURCE_KIND.VERSIONED_DIRS]: scanVersionedDirSource
};

async function scanPackageSourceDirs(source, context) {
  const scanner = PACKAGE_SOURCE_SCANNERS[source.kind];
  return scanner ? scanner(source, context) : [];
}

async function packageManagerExecutableDirs(platform = detectHostOs()) {
  const context = packageSourceContext(platform);
  const sources = PLATFORM_PACKAGE_DIR_SOURCES[platform] || [];
  const dirs = [];
  for (const source of sources) {
    dirs.push(...await scanPackageSourceDirs(source, context));
  }
  return uniqueValues(dirs.filter(Boolean));
}

async function scanCommandSpecificPathSource(source, command, platform) {
  if (source.kind === PACKAGE_SOURCE_KIND.COMMAND_PREFIX_DIRS) {
    const result = await run(source.executable, sourceValues(source.argsForCommand(command), packageSourceContext(platform)), {
      allowFailure: true,
      timeoutMs: source.timeoutMs || SCAN_COMMAND_TIMEOUT_MS
    });
    if (!result.ok || !result.stdout.trim()) {
      return [];
    }
    const dirs = source.mapOutput ? sourceValues(source.mapOutput(result.stdout, packageSourceContext(platform)), packageSourceContext(platform)) : [lastOutputLine(result.stdout)];
    return collectExecutablePathsFromDirs(dirs, command, platform);
  }
  if (source.kind === PACKAGE_SOURCE_KIND.COMMAND_PATHS) {
    const paths = [];
    for (const executable of sourceValues(source.executables, packageSourceContext(platform))) {
      const result = await run(executable, sourceValues(source.argsForCommand(command), packageSourceContext(platform)), {
        allowFailure: true,
        timeoutMs: source.timeoutMs || SCAN_COMMAND_TIMEOUT_MS
      });
      if (result.ok) {
        paths.push(...outputLines(result.stdout));
      }
    }
    return paths;
  }
  return [];
}

async function packageManagerExecutablePaths(command, platform = detectHostOs()) {
  const paths = await collectExecutablePathsFromDirs(await packageManagerExecutableDirs(platform), command, platform);
  for (const source of PLATFORM_PACKAGE_EXECUTABLE_PATH_SOURCES[platform] || []) {
    paths.push(...await scanCommandSpecificPathSource(source, command, platform));
  }
  return uniqueResolvedLocalPaths(await filterProjectLocalPackageExecutables(paths, platform));
}

function appNameLooksAgentRelated(name, command = "") {
  const lower = String(name || "").toLowerCase();
  const normalized = lower.replace(/[^a-z0-9]+/g, " ").trim();
  const commandLower = String(command || "").toLowerCase();
  if (commandLower && normalized.includes(commandLower)) {
    return true;
  }
  if (APP_DISCOVERY_NAME_HINTS.some((hint) => normalized.includes(hint))) {
    return true;
  }
  return APP_DISCOVERY_WORD_HINTS.some((hint) => {
    const pattern = new RegExp(`(^|\\s|-)${hint}(\\s|-|$)`);
    return pattern.test(normalized) || normalized.endsWith(hint);
  });
}

async function macAppExecutablePaths(command) {
  if (process.platform !== "darwin") {
    return [];
  }
  const roots = ["/Applications", path.join(os.homedir(), "Applications")];
  const apps = [];
  for (const root of roots) {
    if (!await directoryExists(root)) {
      continue;
    }
    const found = await run("find", [root, "-maxdepth", "3", "-name", "*.app", "-type", "d"], { allowFailure: true, timeoutMs: 5000 });
    if (found.ok) {
      apps.push(...found.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    }
  }
  const paths = [];
  for (const appPath of apps) {
    const appName = path.basename(appPath, ".app");
    if (!appNameLooksAgentRelated(appName, command)) {
      continue;
    }
    // Do not probe Contents/MacOS/CFBundleExecutable: that is usually the GUI app
    // and may trigger login/keychain prompts. Only pick embedded CLI helper paths.
    paths.push(...await collectExecutablePathsFromDirs([
      path.join(appPath, "Contents", "Resources"),
      path.join(appPath, "Contents", "Resources", "bin"),
      path.join(appPath, "Contents", "Resources", "app", "bin"),
      path.join(appPath, "Contents", "Helpers")
    ], command, "darwin"));
  }
  return paths;
}

function parseDesktopExec(value) {
  const text = String(value || "").replace(/%[fFuUdDnNickvm]/g, "").trim();
  const match = text.match(/^"([^"]+)"/) || text.match(/^'([^']+)'/) || text.match(/^(\S+)/);
  return match?.[1] || "";
}

async function linuxDesktopExecutablePaths(command) {
  if (process.platform !== "linux") {
    return [];
  }
  const roots = [
    "/usr/share/applications",
    "/usr/local/share/applications",
    path.join(os.homedir(), ".local", "share", "applications"),
    "/var/lib/flatpak/exports/share/applications",
    path.join(os.homedir(), ".local", "share", "flatpak", "exports", "share", "applications")
  ];
  const paths = [];
  for (const root of roots) {
    if (!await directoryExists(root)) {
      continue;
    }
    const found = await run("find", [root, "-maxdepth", "2", "-name", "*.desktop", "-type", "f"], { allowFailure: true, timeoutMs: 5000 });
    for (const filePath of found.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
      const content = await fs.readFile(filePath, "utf8").catch(() => "");
      const nameLine = content.split(/\r?\n/).find((line) => line.startsWith("Name="));
      const execLine = content.split(/\r?\n/).find((line) => line.startsWith("Exec="));
      const executable = parseDesktopExec(execLine?.slice("Exec=".length));
      if (!executable) {
        continue;
      }
      const basename = path.basename(executable).toLowerCase();
      const discoveryName = `${path.basename(filePath, ".desktop")} ${nameLine?.slice("Name=".length) || ""} ${basename}`;
      if (!basename.includes(String(command).toLowerCase()) && !appNameLooksAgentRelated(discoveryName, command)) {
        continue;
      }
      if (path.isAbsolute(executable)) {
        paths.push(executable);
      } else {
        paths.push(...await detectPathCommandPaths(executable, "linux"));
      }
    }
  }
  return paths;
}

async function windowsAppExecutablePaths(command) {
  if (process.platform !== "win32") {
    return [];
  }
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$needle = ${JSON.stringify(String(command || "").toLowerCase())}`,
    "$paths = @()",
    "$appPathRoots = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths')",
    "foreach ($root in $appPathRoots) {",
    "  Get-ChildItem $root | Where-Object { $_.PSChildName.ToLower().Contains($needle) } | ForEach-Object {",
    "    $value = (Get-Item $_.PSPath).GetValue('')",
    "    if ($value) { $paths += $value }",
    "  }",
    "}",
    "$shell = New-Object -ComObject WScript.Shell",
    "$shortcutRoots = @([Environment]::GetFolderPath('StartMenu'), [Environment]::GetFolderPath('CommonStartMenu'))",
    "foreach ($root in $shortcutRoots) {",
    "  Get-ChildItem $root -Filter *.lnk -Recurse | Where-Object { $_.BaseName.ToLower().Contains($needle) } | ForEach-Object {",
    "    $target = $shell.CreateShortcut($_.FullName).TargetPath",
    "    if ($target) { $paths += $target }",
    "  }",
    "}",
    "$paths | Select-Object -Unique"
  ].join("\n");
  const result = await run("powershell.exe", ["-NoProfile", "-Command", script], { allowFailure: true, timeoutMs: 5000 });
  if (!result.ok) {
    return [];
  }
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function appDesktopExecutablePaths(command, platform = detectHostOs()) {
  if (platform === "darwin") {
    return macAppExecutablePaths(command);
  }
  if (platform === "linux") {
    return linuxDesktopExecutablePaths(command);
  }
  if (platform === "win32") {
    return windowsAppExecutablePaths(command);
  }
  return [];
}

async function detectLocalCommandPaths(command) {
  const value = String(command || "").trim();
  if (!value) {
    return [];
  }
  const platform = detectHostOs();
  const paths = [
    ...await detectPathCommandPaths(value, platform),
    ...await packageManagerExecutablePaths(value, platform),
    ...await appDesktopExecutablePaths(value, platform)
  ];
  return uniqueResolvedLocalPaths(paths);
}

async function uniqueResolvedLocalPaths(paths) {
  const seen = new Set();
  const deduped = [];
  for (const item of paths) {
    const key = await fs.realpath(item).catch(() => item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

async function directoryExists(dirPath) {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function detectOrbVms(orbBin) {
  const result = await run(orbBin, ["list"], { allowFailure: true, timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
  if (!result.ok) {
    return [];
  }
  const names = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^NAME\s+/i.test(trimmed)) {
      continue;
    }
    const [name] = trimmed.split(/\s+/);
    if (name && !name.startsWith("-")) {
      names.push(name);
    }
  }
  return uniqueValues(names);
}

function linuxExecutableScanScript(command) {
  return [
    "set +e",
    "export HOMEBREW_NO_AUTO_UPDATE=\"${HOMEBREW_NO_AUTO_UPDATE:-1}\"",
    "export HOMEBREW_NO_ANALYTICS=\"${HOMEBREW_NO_ANALYTICS:-1}\"",
    "export HOMEBREW_NO_ENV_HINTS=\"${HOMEBREW_NO_ENV_HINTS:-1}\"",
    `command_name=${shellQuote(command)}`,
    "candidate_rows() {",
    "  type -a -p \"$command_name\" 2>/dev/null | while IFS= read -r item; do printf '%s\\n' \"$item\"; done",
    "  for manager in brew npm pnpm yarn bun; do",
    "    if command -v \"$manager\" >/dev/null 2>&1; then",
    "      case \"$manager\" in",
    "        brew) dir=$($manager --prefix 2>/dev/null); [ -n \"$dir\" ] && printf '%s\\n' \"$dir/bin/$command_name\" \"$dir/sbin/$command_name\" ;;",
    "        npm) dir=$($manager prefix -g 2>/dev/null); [ -n \"$dir\" ] && printf '%s\\n' \"$dir/bin/$command_name\" ;;",
    "        pnpm) dir=$($manager bin -g 2>/dev/null); [ -n \"$dir\" ] && printf '%s\\n' \"$dir/$command_name\" ;;",
    "        yarn) dir=$($manager global bin 2>/dev/null | tail -n 1); [ -n \"$dir\" ] && printf '%s\\n' \"$dir/$command_name\" ;;",
    "        bun) dir=$($manager pm bin -g 2>/dev/null | tail -n 1); [ -n \"$dir\" ] && printf '%s\\n' \"$dir/$command_name\" ;;",
    "      esac",
    "    fi",
    "  done",
    "  printf '%s\\n' \"/usr/local/bin/$command_name\" \"/usr/local/sbin/$command_name\" \"/usr/bin/$command_name\" \"/usr/sbin/$command_name\" \"/bin/$command_name\" \"/sbin/$command_name\" \"/opt/bin/$command_name\"",
    "  printf '%s\\n' \"/opt/homebrew/bin/$command_name\" \"/opt/homebrew/sbin/$command_name\" \"/opt/local/bin/$command_name\" \"/opt/local/sbin/$command_name\" \"/opt/sw/bin/$command_name\"",
    "  nvm_dir=${NVM_DIR:-$HOME/.nvm}",
    "  [ -d \"$nvm_dir/versions/node\" ] && find \"$nvm_dir/versions/node\" -maxdepth 3 -type f -path \"*/bin/$command_name\" 2>/dev/null",
    "  fnm_dir=${FNM_DIR:-$HOME/.local/share/fnm}",
    "  [ -d \"$fnm_dir/node-versions\" ] && find \"$fnm_dir/node-versions\" -maxdepth 4 -type f -path \"*/installation/bin/$command_name\" 2>/dev/null",
    "  [ -d \"$HOME/.nodenv/versions\" ] && find \"$HOME/.nodenv/versions\" -maxdepth 3 -type f -path \"*/bin/$command_name\" 2>/dev/null",
    "  [ -d \"$HOME/.asdf/installs/nodejs\" ] && find \"$HOME/.asdf/installs/nodejs\" -maxdepth 3 -type f -path \"*/bin/$command_name\" 2>/dev/null",
    "  [ -d \"$HOME/.local/share/mise/installs/node\" ] && find \"$HOME/.local/share/mise/installs/node\" -maxdepth 3 -type f -path \"*/bin/$command_name\" 2>/dev/null",
    "  [ -d \"$HOME/.local/share/mise/installs/nodejs\" ] && find \"$HOME/.local/share/mise/installs/nodejs\" -maxdepth 3 -type f -path \"*/bin/$command_name\" 2>/dev/null",
    "  [ -d \"$HOME/.mise/installs/node\" ] && find \"$HOME/.mise/installs/node\" -maxdepth 3 -type f -path \"*/bin/$command_name\" 2>/dev/null",
    "  [ -d \"$HOME/.mise/installs/nodejs\" ] && find \"$HOME/.mise/installs/nodejs\" -maxdepth 3 -type f -path \"*/bin/$command_name\" 2>/dev/null",
    "  printf '%s\\n' \"${VOLTA_HOME:-$HOME/.volta}/bin/$command_name\" \"$HOME/.asdf/shims/$command_name\" \"$HOME/.local/share/mise/shims/$command_name\" \"$HOME/.mise/shims/$command_name\" \"$HOME/.nodenv/shims/$command_name\"",
    "  printf '%s\\n' \"${CARGO_HOME:-$HOME/.cargo}/bin/$command_name\" \"${GOPATH:-$HOME/go}/bin/$command_name\" \"${DENO_INSTALL:-$HOME/.deno}/bin/$command_name\"",
    "  [ -n \"${GOBIN:-}\" ] && printf '%s\\n' \"$GOBIN/$command_name\"",
    "  printf '%s\\n' \"$HOME/.local/bin/$command_name\" \"$HOME/.rye/shims/$command_name\" \"$HOME/.pixi/bin/$command_name\" \"$HOME/.pkgx/bin/$command_name\" \"$HOME/miniconda3/bin/$command_name\" \"$HOME/anaconda3/bin/$command_name\" \"$HOME/.conda/bin/$command_name\" \"/snap/bin/$command_name\"",
    "  printf '%s\\n' \"/var/lib/flatpak/exports/bin/$command_name\" \"$HOME/.local/share/flatpak/exports/bin/$command_name\"",
    "  if command -v pipx >/dev/null 2>&1; then",
    "    pipx_dir=$(pipx environment --value PIPX_BIN_DIR 2>/dev/null)",
    "    [ -n \"$pipx_dir\" ] && printf '%s\\n' \"$pipx_dir/$command_name\"",
    "  fi",
    "  if command -v uv >/dev/null 2>&1; then",
    "    uv_dir=$(uv tool dir --bin 2>/dev/null)",
    "    [ -n \"$uv_dir\" ] && printf '%s\\n' \"$uv_dir/$command_name\"",
    "  fi",
    "  for desktop_root in /usr/share/applications /usr/local/share/applications \"$HOME/.local/share/applications\" /var/lib/flatpak/exports/share/applications \"$HOME/.local/share/flatpak/exports/share/applications\"; do",
    "    [ -d \"$desktop_root\" ] || continue",
    "    find \"$desktop_root\" -maxdepth 2 -name '*.desktop' -type f 2>/dev/null | while IFS= read -r desktop_file; do",
    "      exec_line=$(grep -m 1 '^Exec=' \"$desktop_file\" 2>/dev/null | sed 's/^Exec=//' | sed 's/%[fFuUdDnNickvm]//g')",
    "      [ -n \"$exec_line\" ] || continue",
    "      executable=$(printf '%s\\n' \"$exec_line\" | awk '{print $1}' | sed 's/^\"//;s/\"$//')",
    "      base=$(basename \"$executable\")",
    "      case \"$base\" in *\"$command_name\"*) if printf '%s' \"$executable\" | grep -q '^/'; then printf '%s\\n' \"$executable\"; else command -v \"$executable\" 2>/dev/null; fi ;; esac",
    "    done",
    "  done",
    "}",
    "candidate_rows | while IFS= read -r candidate; do",
    "  [ -n \"$candidate\" ] || continue",
    "  [ -f \"$candidate\" ] || [ -L \"$candidate\" ] || continue",
    "  case \"$candidate\" in",
    "    */node_modules/.bin/*) project_dir=${candidate%%/node_modules/.bin/*}; [ -f \"$project_dir/package.json\" ] && continue ;;",
    "  esac",
    "  resolved=$(readlink -f \"$candidate\" 2>/dev/null || printf '%s' \"$candidate\")",
    "  printf '%s\\t%s\\n' \"$candidate\" \"$resolved\"",
    "done | awk -F '\\t' '!seen[$2]++ { print $1 }'"
  ].join("\n");
}

async function detectOrbCommand({ orbBin, vmName, vmUser, command }) {
  const paths = await detectOrbCommandPaths({ orbBin, vmName, vmUser, command });
  return {
    ok: paths.length > 0,
    path: paths[0] || ""
  };
}

async function detectOrbCommandPaths({ orbBin, vmName, vmUser, command }) {
  const value = String(command || "").trim();
  if (!value || !vmName || !vmUser) {
    return [];
  }
  const probe = path.isAbsolute(value) || value.includes("/")
    ? `command -v ${shellQuote(value)}`
    : linuxExecutableScanScript(value);
  const result = await run(orbBin, [
    "-m",
    vmName,
    "-u",
    vmUser,
    "bash",
    "-lc",
    probe
  ], { allowFailure: true, timeoutMs: REMOTE_SCAN_COMMAND_TIMEOUT_MS });
  if (!result.ok) {
    return [];
  }
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function detectDockerContainers(runtimeBin, kind) {
  const result = await run(runtimeBin, ["ps", "--format", "{{.ID}}\t{{.Names}}"], { allowFailure: true, timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
  if (!result.ok) {
    return [];
  }
  return result.stdout.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, name] = line.split(/\t/);
      return { kind, id, name: name || id, bin: runtimeBin };
    })
    .filter((item) => item.id);
}

function parseRunningTableRows(stdout, { skipHeaderPattern = /^NAME\s+/i } = {}) {
  return outputLines(stdout)
    .filter((line) => !skipHeaderPattern.test(line))
    .map((line) => line.trim())
    .filter(Boolean);
}

function contextListDedup(contexts) {
  const seen = new Set();
  return contexts.filter((context) => {
    const key = `${context.kind}:${context.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function detectLimaInstances(limactlBin) {
  const formatted = await run(limactlBin, ["list", "--format", "{{.Name}}\t{{.Status}}"], {
    allowFailure: true,
    timeoutMs: SCAN_COMMAND_TIMEOUT_MS
  });
  const rows = formatted.ok
    ? outputLines(formatted.stdout)
    : [];
  const contexts = rows
    .map((line) => {
      const [name, status = ""] = line.split(/\t/);
      return { name: String(name || "").trim(), status: String(status || "").trim() };
    })
    .filter((item) => item.name && /^running$/i.test(item.status))
    .map((item) => ({ kind: "lima", id: item.name, name: item.name, bin: limactlBin }));
  if (contexts.length > 0 || formatted.ok) {
    return contexts;
  }
  const fallback = await run(limactlBin, ["list"], { allowFailure: true, timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
  if (!fallback.ok) {
    return [];
  }
  return parseRunningTableRows(fallback.stdout)
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts[0] && parts.some((part) => /^running$/i.test(part)))
    .map((parts) => ({ kind: "lima", id: parts[0], name: parts[0], bin: limactlBin }));
}

async function detectColimaInstances(colimaBin) {
  const json = await run(colimaBin, ["list", "--json"], { allowFailure: true, timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
  if (json.ok) {
    try {
      const payload = JSON.parse(json.stdout || "[]");
      const profiles = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.profiles)
        ? payload.profiles
        : Object.values(payload?.profiles || payload || {});
      return profiles
        .map((profile) => ({
          name: String(profile?.name || profile?.profile || "default"),
          status: String(profile?.status || profile?.state || "")
        }))
        .filter((profile) => profile.name && /^running$/i.test(profile.status))
        .map((profile) => ({ kind: "colima", id: profile.name, name: profile.name, bin: colimaBin }));
    } catch {
      // Fall through to the table parser below.
    }
  }
  const table = await run(colimaBin, ["list"], { allowFailure: true, timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
  if (!table.ok) {
    return [];
  }
  return parseRunningTableRows(table.stdout, { skipHeaderPattern: /^(PROFILE|NAME)\s+/i })
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts[0] && parts.some((part) => /^running$/i.test(part)))
    .map((parts) => ({ kind: "colima", id: parts[0], name: parts[0], bin: colimaBin }));
}

async function detectMultipassInstances(multipassBin) {
  const json = await run(multipassBin, ["list", "--format", "json"], { allowFailure: true, timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
  if (json.ok) {
    try {
      const payload = JSON.parse(json.stdout || "{}");
      const instances = Array.isArray(payload?.list) ? payload.list : [];
      return instances
        .map((item) => ({ name: String(item?.name || ""), state: String(item?.state || "") }))
        .filter((item) => item.name && /^running$/i.test(item.state))
        .map((item) => ({ kind: "multipass", id: item.name, name: item.name, bin: multipassBin }));
    } catch {
      // Fall through to the table parser below.
    }
  }
  const table = await run(multipassBin, ["list"], { allowFailure: true, timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
  if (!table.ok) {
    return [];
  }
  return parseRunningTableRows(table.stdout)
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts[0] && parts.some((part) => /^running$/i.test(part)))
    .map((parts) => ({ kind: "multipass", id: parts[0], name: parts[0], bin: multipassBin }));
}

async function detectLxdLikeInstances(runtimeBin, kind) {
  const result = await run(runtimeBin, ["list", "--format", "csv", "-c", "ns"], {
    allowFailure: true,
    timeoutMs: SCAN_COMMAND_TIMEOUT_MS
  });
  if (!result.ok) {
    return [];
  }
  return outputLines(result.stdout)
    .map((line) => line.split(",").map((part) => part.trim()))
    .filter(([name, state]) => name && /^running$/i.test(state || ""))
    .map(([name]) => ({ kind, id: name, name, bin: runtimeBin }));
}

async function detectVagrantInstances(vagrantBin) {
  const result = await run(vagrantBin, ["global-status", "--prune"], {
    allowFailure: true,
    timeoutMs: SCAN_COMMAND_TIMEOUT_MS
  });
  if (!result.ok) {
    return [];
  }
  return outputLines(result.stdout)
    .map((line) => line.trim())
    .filter((line) => /^[0-9a-f]{7,}\s+/i.test(line))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts[0] && parts.some((part) => /^running$/i.test(part)))
    .map((parts) => ({
      kind: "vagrant",
      id: parts[0],
      name: parts[1] || parts[0],
      bin: vagrantBin
    }));
}

async function detectParallelsVms(prlctlBin) {
  const json = await run(prlctlBin, ["list", "-a", "--json"], {
    allowFailure: true,
    timeoutMs: SCAN_COMMAND_TIMEOUT_MS
  });
  if (json.ok) {
    try {
      const payload = JSON.parse(json.stdout || "[]");
      const vms = Array.isArray(payload) ? payload : Object.values(payload || {});
      return vms
        .map((vm) => ({
          id: String(vm?.ID || vm?.id || vm?.uuid || vm?.UUID || ""),
          name: String(vm?.Name || vm?.name || ""),
          status: String(vm?.Status || vm?.status || "")
        }))
        .filter((vm) => vm.id && /^running$/i.test(vm.status))
        .map((vm) => ({ kind: "parallels", id: vm.id, name: vm.name || vm.id, bin: prlctlBin }));
    } catch {
      // Fall through to the table parser below.
    }
  }
  const table = await run(prlctlBin, ["list", "-a", "-o", "uuid,name,status", "--no-header"], {
    allowFailure: true,
    timeoutMs: SCAN_COMMAND_TIMEOUT_MS
  });
  if (!table.ok) {
    return [];
  }
  return outputLines(table.stdout)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const status = parts[parts.length - 1] || "";
      const id = parts[0] || "";
      const name = parts.slice(1, -1).join(" ") || id;
      return { id, name, status };
    })
    .filter((vm) => vm.id && /^running$/i.test(vm.status))
    .map((vm) => ({ kind: "parallels", id: vm.id, name: vm.name, bin: prlctlBin }));
}

async function detectWslDistros(wslBin) {
  if (detectHostOs() !== "win32") {
    return [];
  }
  const result = await run(wslBin, ["-l", "-q"], { allowFailure: true, timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
  if (!result.ok) {
    return [];
  }
  return result.stdout.split(/\r?\n/)
    .map((line) => line.replace(/\0/g, "").trim())
    .filter(Boolean)
    .map((name) => ({ kind: "wsl", id: name, name, bin: wslBin }));
}

async function remoteLinuxShell(context, script, options = {}) {
  if (["docker", "podman", "nerdctl"].includes(context.kind)) {
    return run(context.bin, ["exec", context.id, "sh", "-lc", script], { allowFailure: true, timeoutMs: options.timeoutMs });
  }
  if (context.kind === "wsl") {
    return run(context.bin, ["-d", context.id, "--", "bash", "-lc", script], { allowFailure: true, timeoutMs: options.timeoutMs });
  }
  if (context.kind === "lima") {
    return run(context.bin, ["shell", context.id, "bash", "-lc", script], { allowFailure: true, timeoutMs: options.timeoutMs });
  }
  if (context.kind === "colima") {
    return run(context.bin, ["ssh", context.id, "--", "bash", "-lc", script], { allowFailure: true, timeoutMs: options.timeoutMs });
  }
  if (["multipass", "lxc", "incus"].includes(context.kind)) {
    return run(context.bin, ["exec", context.id, "--", "bash", "-lc", script], { allowFailure: true, timeoutMs: options.timeoutMs });
  }
  if (context.kind === "vagrant") {
    return run(context.bin, ["ssh", context.id, "-c", `bash -lc ${shellQuote(script)}`], { allowFailure: true, timeoutMs: options.timeoutMs });
  }
  if (context.kind === "parallels") {
    return run(context.bin, ["exec", context.id, "bash", "-lc", script], { allowFailure: true, timeoutMs: options.timeoutMs });
  }
  return { ok: false, stdout: "", stderr: `Unsupported remote context: ${context.kind}` };
}

async function remoteLinuxShellWithInput(context, script, input = "", env = {}, options = {}) {
  const envArgs = Object.entries(env).map(([name, value]) => `${name}=${value}`);
  const runOptions = {
    allowFailure: true,
    timeoutMs: options.timeoutMs || INSTALL_COMMAND_TIMEOUT_MS
  };
  if (["docker", "podman", "nerdctl"].includes(context.kind)) {
    const runtimeEnvArgs = Object.entries(env).flatMap(([name, value]) => ["-e", `${name}=${value}`]);
    return runWithInput(context.bin, ["exec", "-i", ...runtimeEnvArgs, context.id, "sh", "-lc", script], input, runOptions);
  }
  if (context.kind === "wsl") {
    return runWithInput(context.bin, ["-d", context.id, "--", "env", ...envArgs, "bash", "-lc", script], input, runOptions);
  }
  if (context.kind === "lima") {
    return runWithInput(context.bin, ["shell", context.id, "env", ...envArgs, "bash", "-lc", script], input, runOptions);
  }
  if (context.kind === "colima") {
    return runWithInput(context.bin, ["ssh", context.id, "--", "env", ...envArgs, "bash", "-lc", script], input, runOptions);
  }
  if (["multipass", "lxc", "incus"].includes(context.kind)) {
    return runWithInput(context.bin, ["exec", context.id, "--", "env", ...envArgs, "bash", "-lc", script], input, runOptions);
  }
  if (context.kind === "vagrant") {
    const command = `env ${envArgs.map(shellQuote).join(" ")} bash -lc ${shellQuote(script)}`;
    return runWithInput(context.bin, ["ssh", context.id, "-c", command], input, runOptions);
  }
  if (context.kind === "parallels") {
    return runWithInput(context.bin, ["exec", context.id, "env", ...envArgs, "bash", "-lc", script], input, runOptions);
  }
  return { ok: false, stdout: "", stderr: `Unsupported remote context: ${context.kind}` };
}

async function runRemoteLinuxCommand(context, args = [], options = {}) {
  const timeoutMs = options.timeoutMs || INSTALL_COMMAND_TIMEOUT_MS;
  const runOptions = {
    allowFailure: options.allowFailure,
    timeoutMs
  };
  if (["docker", "podman", "nerdctl"].includes(context.kind)) {
    return run(context.bin, ["exec", context.id, ...args], runOptions);
  }
  if (context.kind === "wsl") {
    return run(context.bin, ["-d", context.id, "--", ...args], runOptions);
  }
  if (context.kind === "lima") {
    return run(context.bin, ["shell", context.id, ...args], runOptions);
  }
  if (context.kind === "colima") {
    return run(context.bin, ["ssh", context.id, "--", ...args], runOptions);
  }
  if (["multipass", "lxc", "incus"].includes(context.kind)) {
    return run(context.bin, ["exec", context.id, "--", ...args], runOptions);
  }
  if (context.kind === "vagrant") {
    return run(context.bin, ["ssh", context.id, "-c", args.map(shellQuote).join(" ")], runOptions);
  }
  if (context.kind === "parallels") {
    return run(context.bin, ["exec", context.id, ...args], runOptions);
  }
  const message = `Unsupported remote context: ${context.kind}`;
  if (options.allowFailure) {
    return { ok: false, stdout: "", stderr: message };
  }
  throw new Error(message);
}

async function detectRemoteLinuxCommandPaths(context, command) {
  const value = String(command || "").trim();
  if (!value) {
    return [];
  }
  const probe = path.isAbsolute(value) || value.includes("/")
    ? `command -v ${shellQuote(value)}`
    : linuxExecutableScanScript(value);
  const result = await remoteLinuxShell(context, probe, { timeoutMs: REMOTE_SCAN_COMMAND_TIMEOUT_MS });
  if (!result.ok) {
    return [];
  }
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function remoteLinuxCommandSupportsMcp(context, command) {
  const result = await runRemoteLinuxCommand(context, [command, "mcp", "--help"], { allowFailure: true, timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
  return mcpProbeSupported(result);
}

async function remoteClientBaseUrl(context, baseUrl) {
  if (context.kind === "orb") {
    return vmBaseUrl(baseUrl);
  }
  const parsed = new URL(baseUrl);
  if (!isLoopbackHost(parsed.hostname)) {
    return baseUrl;
  }
  if (context.kind === "podman") {
    return baseUrlWithHost(baseUrl, "host.containers.internal");
  }
  if (context.kind === "docker" || context.kind === "nerdctl") {
    if (detectHostOs() === "linux") {
      const gateway = await run(context.bin, [
        "inspect",
        "-f",
        "{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}",
        context.id
      ], { allowFailure: true });
      const host = gateway.stdout.trim().split(/\s+/).find(Boolean);
      if (host) {
        return baseUrlWithHost(baseUrl, host);
      }
    }
    return baseUrlWithHost(baseUrl, "host.docker.internal");
  }
  if (context.kind === "lima" || context.kind === "colima") {
    return baseUrlWithHost(baseUrl, "host.lima.internal");
  }
  if (context.kind === "wsl") {
    const nameserver = await remoteLinuxShell(context, "awk '/^nameserver / { print $2; exit }' /etc/resolv.conf 2>/dev/null", { timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
    const host = nameserver.stdout.trim().split(/\s+/).find(Boolean);
    return host ? baseUrlWithHost(baseUrl, host) : baseUrl;
  }
  if (["multipass", "lxc", "incus", "vagrant", "parallels"].includes(context.kind)) {
    const gateway = await remoteLinuxShell(context, "ip route show default 2>/dev/null | awk '{ print $3; exit }'", { timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
    const host = gateway.stdout.trim().split(/\s+/).find(Boolean);
    return host ? baseUrlWithHost(baseUrl, host) : baseUrl;
  }
  return baseUrl;
}

function candidateLocation(candidate) {
  return String(candidate?.optionOverrides?.["execution-location"] || "local");
}

function isGenericRemoteLocation(location) {
  return GENERIC_REMOTE_CONTEXT_KINDS.includes(location);
}

function candidateIdentity(candidate) {
  const overrides = candidate.optionOverrides || {};
  const location = candidateLocation(candidate);
  if (candidate?.target === "hermes") {
    if (location === "orb") {
      const vmName = String(overrides["hermes-vm"] || overrides["orb-vm"] || "").trim();
      const vmUser = String(overrides["hermes-user"] || overrides["orb-user"] || "").trim();
      const hermesBin = String(overrides["hermes-bin"] || "").trim();
      return vmName && vmUser && hermesBin ? `hermes:orb:${vmName}:${vmUser}:${hermesBin}` : "";
    }
    if (isGenericRemoteLocation(location)) {
      const remoteId = String(overrides["remote-id"] || "").trim();
      const hermesBin = String(overrides["hermes-bin"] || "").trim();
      return remoteId && hermesBin ? `hermes:${location}:${remoteId}:${hermesBin}` : "";
    }
    return "";
  }
  if (candidate?.target === "openclaw") {
    const openclawBin = String(overrides["openclaw-bin"] || "").trim();
    if (location === "orb") {
      const vmName = String(overrides["orb-vm"] || overrides["openclaw-vm"] || "").trim();
      const vmUser = String(overrides["orb-user"] || overrides["openclaw-user"] || "").trim();
      return vmName && vmUser && openclawBin ? `openclaw:orb:${vmName}:${vmUser}:${openclawBin}` : "";
    }
    if (isGenericRemoteLocation(location)) {
      const remoteId = String(overrides["remote-id"] || "").trim();
      return remoteId && openclawBin ? `openclaw:${location}:${remoteId}:${openclawBin}` : "";
    }
    return openclawBin ? `openclaw:local:${openclawBin}` : "";
  }
  if (candidate?.target === "claude-code") {
    if (location === "orb") {
      const vmName = String(overrides["orb-vm"] || "").trim();
      const vmUser = String(overrides["orb-user"] || "").trim();
      return vmName && vmUser ? `claude-code:orb:${vmName}:${vmUser}` : "";
    }
    if (isGenericRemoteLocation(location)) {
      const remoteId = String(overrides["remote-id"] || "").trim();
      return remoteId ? `claude-code:${location}:${remoteId}` : "";
    }
    const claudeBin = String(overrides["claude-bin"] || "").trim();
    return claudeBin ? `claude-code:local:${claudeBin}` : "";
  }
  if (location === "orb" && ["codex", "copilot", "kilo-code", "opencode"].includes(candidate?.target)) {
    const vmName = String(overrides["orb-vm"] || "").trim();
    const vmUser = String(overrides["orb-user"] || "").trim();
    return vmName && vmUser ? `${candidate.target}:orb:${vmName}:${vmUser}` : "";
  }
  if (isGenericRemoteLocation(location) && ["codex", "copilot", "kilo-code", "opencode"].includes(candidate?.target)) {
    const remoteId = String(overrides["remote-id"] || "").trim();
    return remoteId ? `${candidate.target}:${location}:${remoteId}` : "";
  }
  if (location === "local" && ["codex", "copilot", "kilo-code", "opencode", "claude-code"].includes(candidate?.target)) {
    const descriptor = AGENT_CLI_TARGETS.find((item) => item.target === candidate.target);
    const binPath = descriptor ? String(overrides[descriptor.binOption] || "").trim() : "";
    return binPath ? `${candidate.target}:local:${binPath}` : "";
  }
  return "";
}

function mergeInstallCandidate(candidates, candidate) {
  const identity = candidateIdentity(candidate);
  if (!identity) {
    candidates.push(candidate);
    return;
  }
  const existingIndex = candidates.findIndex((item) => candidateIdentity(item) === identity);
  if (existingIndex < 0) {
    candidates.push(candidate);
    return;
  }
  const existing = candidates[existingIndex];
  if (existing.status !== "detected" && candidate.status === "detected") {
    candidates[existingIndex] = {
      ...existing,
      status: "detected",
      detail: candidate.detail,
      optionOverrides: {
        ...(existing.optionOverrides || {}),
        ...(candidate.optionOverrides || {})
      }
    };
    return;
  }
  if (existing.status === "detected" && candidate.status === "detected") {
    return;
  }
  if (existing.status === candidate.status && existing.detail !== candidate.detail) {
    candidates[existingIndex] = {
      ...existing,
      detail: existing.status === "detected" ? existing.detail : candidate.detail,
      optionOverrides: {
        ...(existing.optionOverrides || {}),
        ...(candidate.optionOverrides || {})
      }
    };
  }
}

function mcpProbeSupported(result) {
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.toLowerCase();
  const normalized = output.replace(/\s+/g, " ").trim();
  const hasMcpSignal = /\bmcp\b/.test(normalized) || normalized.includes("model context protocol");
  if (!hasMcpSignal) {
    return false;
  }
  const negativePatterns = [
    /\bunknown (?:command|subcommand)\b/,
    /\bunrecognized (?:command|subcommand)\b/,
    /\bno such (?:command|subcommand)\b/,
    /\bcommand not found\b/,
    /\bnot (?:a )?recognized (?:as )?(?:a )?command\b/,
    /\binvalid choice\b.*\bmcp\b/,
    /\bno help topic\b.*\bmcp\b/,
    /\bmcp\b.*\b(?:does not exist|not found|not supported|unsupported)\b/,
    /\b(?:does not support|unsupported)\b.*\bmcp\b/
  ];
  if (negativePatterns.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  const positivePatterns = [
    /\busage:\s*[^\r\n]*\bmcp\b/,
    /\bcommands?:\b/,
    /\bmcp\b.{0,120}\b(?:add|remove|list|get|enable|disable|login|logout|auth|server|configuration|protocol)\b/,
    /\bmanage\b.{0,80}\bmcp\b/,
    /\bmodel context protocol\b/
  ];
  return positivePatterns.some((pattern) => pattern.test(normalized)) || Boolean(result.ok);
}

function mcpOutputHasPact(result) {
  const output = `${result?.stdout || ""}\n${result?.stderr || ""}`;
  return new RegExp(`(^|[^a-z0-9_-])${MCP_SERVER_NAME}([^a-z0-9_-]|$)`, "i").test(output);
}

function candidateBin(candidate, settings) {
  const overrides = candidate.optionOverrides || {};
  if (candidate.target === "codex") {
    return String(overrides["codex-bin"] || settings.codexBin || "");
  }
  if (candidate.target === "claude-code") {
    return String(overrides["claude-bin"] || settings.claudeBin || "");
  }
  if (candidate.target === "kilo-code") {
    return String(overrides["kilo-bin"] || settings.kiloBin || "");
  }
  if (candidate.target === "copilot") {
    return String(overrides["copilot-bin"] || settings.copilotBin || "");
  }
  if (candidate.target === "opencode") {
    return String(overrides["opencode-bin"] || settings.opencodeBin || "");
  }
  if (candidate.target === "openclaw") {
    return String(overrides["openclaw-bin"] || settings.openclawBin || "");
  }
  if (candidate.target === "hermes") {
    return String(overrides["hermes-bin"] || settings.hermesBin || "");
  }
  return "";
}

function candidateRemoteContext(candidate) {
  const location = candidateLocation(candidate);
  if (!isGenericRemoteLocation(location)) {
    return null;
  }
  const overrides = candidate.optionOverrides || {};
  return {
    kind: location,
    id: String(overrides["remote-id"] || ""),
    name: String(overrides["remote-name"] || ""),
    bin: String(overrides["remote-bin"] || "")
  };
}

async function runCandidateClientCommand(settings, candidate, args = []) {
  const command = candidateBin(candidate, settings);
  if (!command) {
    return { ok: false, stdout: "", stderr: "missing client command" };
  }
  const overrides = candidate.optionOverrides || {};
  const location = candidateLocation(candidate);
  if (location === "orb") {
    const vmName = String(overrides["orb-vm"] || overrides["openclaw-vm"] || overrides["hermes-vm"] || settings.orbVm || "");
    const vmUser = String(overrides["orb-user"] || overrides["openclaw-user"] || overrides["hermes-user"] || settings.orbUser || "");
    if (!vmName || !vmUser) {
      return { ok: false, stdout: "", stderr: "missing OrbStack VM or user" };
    }
    return run(settings.orbBin, ["-m", vmName, "-u", vmUser, command, ...args], {
      allowFailure: true,
      timeoutMs: SCAN_COMMAND_TIMEOUT_MS
    });
  }
  const remoteContext = candidateRemoteContext(candidate);
  if (remoteContext) {
    return runRemoteLinuxCommand(remoteContext, [command, ...args], {
      allowFailure: true,
      timeoutMs: SCAN_COMMAND_TIMEOUT_MS
    });
  }
  return run(command, args, { allowFailure: true, timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
}

function configHasPactMcp(config) {
  return Boolean(
    config?.mcp?.[MCP_SERVER_NAME] ||
    config?.mcpServers?.[MCP_SERVER_NAME] ||
    config?.servers?.[MCP_SERVER_NAME]
  );
}

async function localJsonConfigHasPact(filePath) {
  return configHasPactMcp(await readJson(filePath, {}));
}

async function remoteHomeConfigHasPact(settings, candidate, relativePath) {
  const overrides = candidate.optionOverrides || {};
  const location = candidateLocation(candidate);
  const script = `test -f "$HOME/${relativePath}" && grep -q '"${MCP_SERVER_NAME}"' "$HOME/${relativePath}"`;
  if (location === "orb") {
    const vmName = String(overrides["orb-vm"] || settings.orbVm || "");
    const vmUser = String(overrides["orb-user"] || settings.orbUser || "");
    if (!vmName || !vmUser) {
      return false;
    }
    const result = await run(settings.orbBin, ["-m", vmName, "-u", vmUser, "bash", "-lc", script], {
      allowFailure: true,
      timeoutMs: SCAN_COMMAND_TIMEOUT_MS
    });
    return result.ok;
  }
  const remoteContext = candidateRemoteContext(candidate);
  if (remoteContext) {
    const result = await remoteLinuxShell(remoteContext, script, { timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
    return result.ok;
  }
  return false;
}

async function candidateHasInstalledPactMcp(settings, candidate) {
  if (candidate.target === "antigravity") {
    return localJsonConfigHasPact(settings.antigravityConfigPath);
  }
  if (candidate.target === "cursor") {
    return localJsonConfigHasPact(settings.cursorConfigPath);
  }
  if (candidate.target === "opencode") {
    return candidateLocation(candidate) === "local"
      ? localJsonConfigHasPact(settings.opencodeConfigPath)
      : remoteHomeConfigHasPact(settings, candidate, ".config/opencode/opencode.jsonc");
  }
  if (candidate.status !== "detected") {
    return false;
  }
  if (candidate.target === "codex") {
    const result = await runCandidateClientCommand(settings, candidate, ["mcp", "get", MCP_SERVER_NAME]);
    return result.ok && mcpOutputHasPact(result);
  }
  if (candidate.target === "claude-code") {
    const result = await runCandidateClientCommand(settings, candidate, ["mcp", "get", MCP_SERVER_NAME]);
    return result.ok && mcpOutputHasPact(result);
  }
  if (candidate.target === "copilot") {
    const result = await runCandidateClientCommand(settings, candidate, ["mcp", "get", MCP_SERVER_NAME]);
    return result.ok && mcpOutputHasPact(result);
  }
  if (candidate.target === "openclaw") {
    const result = await runCandidateClientCommand(settings, candidate, ["mcp", "show", MCP_SERVER_NAME]);
    return result.ok && mcpOutputHasPact(result);
  }
  if (candidate.target === "hermes") {
    const result = await runCandidateClientCommand(settings, candidate, ["mcp", "list"]);
    return result.ok && mcpOutputHasPact(result);
  }
  if (candidate.target === "kilo-code") {
    const result = await runCandidateClientCommand(settings, candidate, ["mcp", "list"]);
    if (result.ok && mcpOutputHasPact(result)) {
      return true;
    }
    if (candidateLocation(candidate) === "local") {
      return localJsonConfigHasPact(settings.kiloConfigPath);
    }
    return remoteHomeConfigHasPact(settings, candidate, ".config/kilo/kilo.json");
  }
  return false;
}

async function annotateInstalledCandidates(settings, candidates) {
  for (const candidate of candidates) {
    candidate.installed = await candidateHasInstalledPactMcp(settings, candidate).catch(() => false);
  }
  return candidates;
}

async function commandSupportsMcp(command, argsPrefix = []) {
  const result = await run(command, [...argsPrefix, "mcp", "--help"], { allowFailure: true, timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
  return mcpProbeSupported(result);
}

async function orbCommandSupportsMcp({ orbBin, vmName, vmUser, command }) {
  const result = await run(orbBin, [
    "-m",
    vmName,
    "-u",
    vmUser,
    command,
    "mcp",
    "--help"
  ], { allowFailure: true, timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
  return mcpProbeSupported(result);
}

async function detectLocalClawCompatibleTargets() {
  const candidates = [];
  for (const commandName of CLAW_COMPATIBLE_COMMANDS) {
    const paths = await detectLocalCommandPaths(commandName);
    for (const detectedPath of paths) {
      if (!await commandSupportsMcp(detectedPath)) {
        continue;
      }
      candidates.push({
        id: `claw-compatible:local:${detectedPath}`,
        target: "openclaw",
        label: `${commandName} (local)`,
        status: "detected",
        detail: `claw-compatible MCP CLI at ${detectedPath}`,
        optionOverrides: {
          "execution-location": "local",
          "openclaw-bin": detectedPath
        }
      });
    }
  }
  return candidates;
}

function descriptorConfiguredBin(settings, descriptor) {
  if (descriptor.target === "codex") return settings.codexBin;
  if (descriptor.target === "claude-code") return settings.claudeBin;
  if (descriptor.target === "copilot") return settings.copilotBin;
  if (descriptor.target === "kilo-code") return settings.kiloBin;
  if (descriptor.target === "opencode") return settings.opencodeBin;
  return "";
}

async function detectExplicitLocalAgentCliTargets(settings, options = {}) {
  const candidates = [];
  for (const descriptor of AGENT_CLI_TARGETS) {
    if (!Object.hasOwn(options, descriptor.binOption)) {
      continue;
    }
    const configuredBin = descriptorConfiguredBin(settings, descriptor);
    const paths = await detectLocalCommandPaths(configuredBin);
    for (const detectedPath of paths) {
      const supportsMcp = await commandSupportsMcp(detectedPath);
      candidates.push({
        id: `${descriptor.target}:local:${detectedPath}`,
        target: descriptor.target,
        label: descriptor.label,
        status: "detected",
        mcpProbe: supportsMcp ? "supported" : "inconclusive",
        detail: supportsMcp ? detectedPath : `${detectedPath} (explicit path; MCP probe inconclusive)`,
        optionOverrides: {
          "execution-location": "local",
          [descriptor.binOption]: detectedPath
        }
      });
    }
  }
  return candidates;
}

async function detectExplicitLocalClawCompatibleTargets(settings, options = {}) {
  const openclawBin = String(option(options, "openclaw-bin", settings.openclawBin || "")).trim();
  if (!openclawBin || !Object.hasOwn(options, "openclaw-bin")) {
    return [];
  }
  const paths = await detectLocalCommandPaths(openclawBin);
  const candidates = [];
  for (const detectedPath of paths) {
    const supportsMcp = await commandSupportsMcp(detectedPath);
    candidates.push({
      id: `claw-compatible:local:${detectedPath}`,
      target: "openclaw",
      label: targetLabel("openclaw"),
      status: "detected",
      mcpProbe: supportsMcp ? "supported" : "inconclusive",
      detail: supportsMcp
        ? `claw-compatible MCP CLI at ${detectedPath}`
        : `claw-compatible explicit CLI at ${detectedPath}; MCP probe inconclusive`,
      optionOverrides: {
        "execution-location": "local",
        "openclaw-bin": detectedPath
      }
    });
  }
  return candidates;
}

async function detectLocalAgentCliTargets() {
  const candidates = [];
  for (const descriptor of AGENT_CLI_TARGETS) {
    for (const commandName of descriptor.commandNames) {
      const paths = await detectLocalCommandPaths(commandName);
      for (const detectedPath of paths) {
        if (!await commandSupportsMcp(detectedPath)) {
          continue;
        }
        candidates.push({
          id: `${descriptor.target}:local:${detectedPath}`,
          target: descriptor.target,
          label: descriptor.label,
          status: "detected",
          detail: detectedPath,
          optionOverrides: {
            "execution-location": "local",
            [descriptor.binOption]: detectedPath
          }
        });
      }
    }
  }
  return candidates;
}

function configuredOrbUserCandidates(settings, vmName) {
  return uniqueValues([
    settings.orbUser,
    settings.openclawVmUser,
    settings.hermesVmUser,
    vmName,
    "root"
  ]);
}

async function detectOrbUserCandidates(settings, vmName) {
  const fallback = configuredOrbUserCandidates(settings, vmName);
  const script = [
    "awk -F: '($3 >= 1000 || $1 == \"root\") && $6 != \"\" && $7 !~ /(false|nologin)$/ { print $1 }' /etc/passwd 2>/dev/null"
  ].join("\n");
  const result = await run(settings.orbBin, [
    "-m",
    vmName,
    "-u",
    "root",
    "bash",
    "-lc",
    script
  ], { allowFailure: true, timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
  return uniqueValues([
    ...fallback,
    ...(result.ok ? outputLines(result.stdout) : [])
  ]);
}

async function detectOrbClawCompatibleTargets(settings, vmNames = null) {
  const names = vmNames || await detectOrbVms(settings.orbBin);
  const candidates = [];
  for (const vmName of names) {
    const userCandidates = await detectOrbUserCandidates(settings, vmName);
    for (const vmUser of userCandidates) {
      for (const commandName of CLAW_COMPATIBLE_COMMANDS) {
        const paths = await detectOrbCommandPaths({
          orbBin: settings.orbBin,
          vmName,
          vmUser,
          command: commandName
        });
        for (const detectedPath of paths) {
          if (!await orbCommandSupportsMcp({ orbBin: settings.orbBin, vmName, vmUser, command: detectedPath })) {
            continue;
          }
          candidates.push({
            id: `claw-compatible:orb:${vmName}:${vmUser}:${detectedPath}`,
            target: "openclaw",
            label: `${targetLabel("openclaw")} (${vmName})`,
            status: "detected",
            detail: `claw-compatible MCP CLI at ${detectedPath}, user ${vmUser}`,
            optionOverrides: {
              "execution-location": "orb",
              "orb-vm": vmName,
              "orb-user": vmUser,
              "openclaw-vm": vmName,
              "openclaw-user": vmUser,
              "openclaw-bin": detectedPath
            }
          });
        }
      }
    }
  }
  return candidates;
}

async function detectOrbAgentCliTargets(settings, vmNames = null) {
  const names = vmNames || await detectOrbVms(settings.orbBin);
  const candidates = [];
  for (const vmName of names) {
    const userCandidates = await detectOrbUserCandidates(settings, vmName);
    for (const vmUser of userCandidates) {
      for (const descriptor of ORB_AGENT_CLI_TARGETS) {
        for (const commandName of descriptor.commandNames) {
          const paths = await detectOrbCommandPaths({
            orbBin: settings.orbBin,
            vmName,
            vmUser,
            command: commandName
          });
          for (const detectedPath of paths) {
            if (!await orbCommandSupportsMcp({ orbBin: settings.orbBin, vmName, vmUser, command: detectedPath })) {
              continue;
            }
            candidates.push({
              id: `${descriptor.target}:orb:${vmName}:${vmUser}:${detectedPath}`,
              target: descriptor.target,
              label: `${descriptor.label} (${vmName})`,
              status: "detected",
              detail: `${descriptor.label} CLI at ${detectedPath}, user ${vmUser}`,
              optionOverrides: {
                "execution-location": "orb",
                "orb-vm": vmName,
                "orb-user": vmUser,
                [descriptor.binOption]: detectedPath
              }
            });
          }
        }
      }
    }
  }
  return candidates;
}

async function detectOrbHermesCommandPaths({ orbBin, vmName, vmUser, hermesBin = "" }) {
  const paths = [];
  if (hermesBin) {
    paths.push(...await detectOrbCommandPaths({ orbBin, vmName, vmUser, command: hermesBin }));
  }
  for (const commandName of HERMES_COMMAND_NAMES) {
    paths.push(...await detectOrbCommandPaths({ orbBin, vmName, vmUser, command: commandName }));
  }
  const script = [
    "set +e",
    "for candidate in \"$HOME/.hermes/hermes-agent/venv/bin/hermes\" \"$HOME/.local/bin/hermes\" \"$HOME/.hermes/bin/hermes\"; do",
    "  [ -f \"$candidate\" ] || [ -L \"$candidate\" ] || continue",
    "  printf '%s\\n' \"$candidate\"",
    "done"
  ].join("\n");
  const result = await run(orbBin, [
    "-m",
    vmName,
    "-u",
    vmUser,
    "bash",
    "-lc",
    script
  ], { allowFailure: true, timeoutMs: SCAN_COMMAND_TIMEOUT_MS });
  if (result.ok) {
    paths.push(...outputLines(result.stdout));
  }
  return uniqueValues(paths);
}

async function detectOrbHermesTargets(settings, vmNames = null) {
  const names = vmNames || await detectOrbVms(settings.orbBin);
  const candidates = [];
  for (const vmName of names) {
    const userCandidates = await detectOrbUserCandidates(settings, vmName);
    for (const vmUser of userCandidates) {
      const paths = await detectOrbHermesCommandPaths({
        orbBin: settings.orbBin,
        vmName,
        vmUser,
        hermesBin: settings.hermesBin
      });
      for (const detectedPath of paths) {
        if (!await orbCommandSupportsMcp({ orbBin: settings.orbBin, vmName, vmUser, command: detectedPath })) {
          continue;
        }
        candidates.push({
          id: `hermes:orb:${vmName}:${vmUser}:${detectedPath}`,
          target: "hermes",
          label: `${targetLabel("hermes")} (${vmName})`,
          status: "detected",
          detail: `Hermes CLI at ${detectedPath}, user ${vmUser}`,
          optionOverrides: {
            "execution-location": "orb",
            "orb-vm": vmName,
            "orb-user": vmUser,
            "hermes-vm": vmName,
            "hermes-user": vmUser,
            "hermes-bin": detectedPath
          }
        });
      }
    }
  }
  return candidates;
}

async function detectContainerVmContexts(settings) {
  const contexts = [
    ...await detectDockerContainers(settings.dockerBin, "docker"),
    ...await detectDockerContainers(settings.podmanBin, "podman"),
    ...await detectDockerContainers(settings.nerdctlBin, "nerdctl"),
    ...await detectWslDistros(settings.wslBin),
    ...await detectLimaInstances(settings.limaBin),
    ...await detectColimaInstances(settings.colimaBin),
    ...await detectMultipassInstances(settings.multipassBin),
    ...await detectLxdLikeInstances(settings.lxcBin, "lxc"),
    ...await detectLxdLikeInstances(settings.incusBin, "incus"),
    ...await detectVagrantInstances(settings.vagrantBin),
    ...await detectParallelsVms(settings.parallelsBin)
  ];
  return contextListDedup(contexts);
}

function remoteContextLabel(context) {
  return `${context.kind}:${context.name || context.id}`;
}

function remoteContextOptionOverrides(context, extra = {}) {
  return {
    "execution-location": context.kind,
    "remote-kind": context.kind,
    "remote-id": context.id,
    "remote-name": context.name || context.id,
    "remote-bin": context.bin,
    ...extra
  };
}

async function detectRemoteLinuxClawCompatibleTargets(contexts) {
  const candidates = [];
  for (const context of contexts) {
    for (const commandName of CLAW_COMPATIBLE_COMMANDS) {
      const paths = await detectRemoteLinuxCommandPaths(context, commandName);
      for (const detectedPath of paths) {
        if (!await remoteLinuxCommandSupportsMcp(context, detectedPath)) {
          continue;
        }
        candidates.push({
          id: `claw-compatible:${context.kind}:${context.id}:${detectedPath}`,
          target: "openclaw",
          label: `${targetLabel("openclaw")} (${remoteContextLabel(context)})`,
          status: "detected",
          detail: `claw-compatible MCP CLI at ${detectedPath}`,
          optionOverrides: remoteContextOptionOverrides(context, {
            "openclaw-bin": detectedPath
          })
        });
      }
    }
  }
  return candidates;
}

async function detectRemoteLinuxAgentCliTargets(contexts) {
  const candidates = [];
  for (const context of contexts) {
    for (const descriptor of ORB_AGENT_CLI_TARGETS) {
      for (const commandName of descriptor.commandNames) {
        const paths = await detectRemoteLinuxCommandPaths(context, commandName);
        for (const detectedPath of paths) {
          if (!await remoteLinuxCommandSupportsMcp(context, detectedPath)) {
            continue;
          }
          candidates.push({
            id: `${descriptor.target}:${context.kind}:${context.id}:${detectedPath}`,
            target: descriptor.target,
            label: `${descriptor.label} (${remoteContextLabel(context)})`,
            status: "detected",
            detail: `${descriptor.label} CLI at ${detectedPath}`,
            optionOverrides: remoteContextOptionOverrides(context, {
              [descriptor.binOption]: detectedPath
            })
          });
        }
      }
    }
  }
  return candidates;
}

async function detectRemoteLinuxHermesCommandPaths(context) {
  const paths = [];
  for (const commandName of HERMES_COMMAND_NAMES) {
    paths.push(...await detectRemoteLinuxCommandPaths(context, commandName));
  }
  const script = [
    "set +e",
    "for candidate in \"$HOME/.hermes/hermes-agent/venv/bin/hermes\" \"$HOME/.local/bin/hermes\" \"$HOME/.hermes/bin/hermes\"; do",
    "  [ -f \"$candidate\" ] || [ -L \"$candidate\" ] || continue",
    "  printf '%s\\n' \"$candidate\"",
    "done"
  ].join("\n");
  const result = await remoteLinuxShell(context, script, { timeoutMs: REMOTE_SCAN_COMMAND_TIMEOUT_MS });
  if (result.ok) {
    paths.push(...outputLines(result.stdout));
  }
  return uniqueValues(paths);
}

async function detectRemoteLinuxHermesTargets(contexts) {
  const candidates = [];
  for (const context of contexts) {
    const paths = await detectRemoteLinuxHermesCommandPaths(context);
    for (const detectedPath of paths) {
      if (!await remoteLinuxCommandSupportsMcp(context, detectedPath)) {
        continue;
      }
      candidates.push({
        id: `hermes:${context.kind}:${context.id}:${detectedPath}`,
        target: "hermes",
        label: `${targetLabel("hermes")} (${remoteContextLabel(context)})`,
        status: "detected",
        detail: `Hermes CLI at ${detectedPath}`,
        optionOverrides: remoteContextOptionOverrides(context, {
          "hermes-bin": detectedPath
        })
      });
    }
  }
  return candidates;
}

async function scanInstallTargets(options = {}) {
  const settings = installerOptions(options);
  const candidates = [];
  if (!options["no-scan"]) {
    const vmNames = await detectOrbVms(settings.orbBin);
    const remoteContexts = await detectContainerVmContexts(settings);
    const discoveredCandidates = [
      ...await detectLocalAgentCliTargets(settings),
      ...await detectLocalClawCompatibleTargets(settings),
      ...await detectOrbClawCompatibleTargets(settings, vmNames),
      ...await detectOrbAgentCliTargets(settings, vmNames),
      ...await detectOrbHermesTargets(settings, vmNames),
      ...await detectRemoteLinuxClawCompatibleTargets(remoteContexts),
      ...await detectRemoteLinuxAgentCliTargets(remoteContexts),
      ...await detectRemoteLinuxHermesTargets(remoteContexts)
    ];
    for (const candidate of discoveredCandidates) {
      mergeInstallCandidate(candidates, candidate);
    }
  } else {
    const explicitCandidates = [
      ...await detectExplicitLocalAgentCliTargets(settings, options),
      ...await detectExplicitLocalClawCompatibleTargets(settings, options)
    ];
    for (const candidate of explicitCandidates) {
      mergeInstallCandidate(candidates, candidate);
    }
    for (const descriptor of AGENT_CLI_TARGETS) {
      if (explicitCandidates.some((candidate) => candidate.target === descriptor.target)) {
        continue;
      }
      mergeInstallCandidate(candidates, {
        id: descriptor.target,
        target: descriptor.target,
        label: descriptor.label,
        status: "not-detected",
        detail: `${descriptor.commandNames.join("/")} executable scan disabled`
      });
    }
  }
  const antigravityConfigDir = path.dirname(settings.antigravityConfigPath);
  const antigravityDetected = await pathExists(settings.antigravityConfigPath) || await directoryExists(antigravityConfigDir);
  const cursorConfigDir = path.dirname(settings.cursorConfigPath);
  const cursorDetected = await pathExists(settings.cursorConfigPath) || await directoryExists(cursorConfigDir);
  for (const configTarget of [
    ["antigravity", settings.antigravityConfigPath, antigravityDetected],
    ["cursor", settings.cursorConfigPath, cursorDetected]
  ]) {
    const [target, configPath, detected] = configTarget;
    candidates.push({
      id: target,
      target,
      label: targetLabel(target),
      status: detected ? "detected" : "not-detected",
      detail: detected ? `config: ${configPath}` : notDetectedTargetDetail(target)
    });
  }
  for (const target of SUPPORTED_TARGETS) {
    if (candidates.some((candidate) => candidate.target === target)) {
      continue;
    }
    candidates.push({
      id: target,
      target,
      label: targetLabel(target),
      status: "not-detected",
      detail: notDetectedTargetDetail(target)
    });
  }
  await annotateInstalledCandidates(settings, candidates);

  return {
    ok: true,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    hostOs: settings.hostOs,
    baseUrl: settings.baseUrl,
    mcpUrl: settings.baseUrl ? `${settings.baseUrl}/mcp` : "",
    candidates: candidates.map((candidate) => withInstallCandidateGuidance(candidate, settings))
  };
}

function installerOptions(options) {
  const sharedVmName = option(options, "vm", "");
  const sharedVmUser = option(options, "vm-user", "");
  const hasVmTarget = Boolean(
    sharedVmName ||
    sharedVmUser ||
    option(options, "orb-vm", "") ||
    option(options, "orb-user", "") ||
    option(options, "openclaw-vm", "") ||
    option(options, "openclaw-user", "") ||
    option(options, "hermes-vm", "") ||
    option(options, "hermes-user", "")
  );
  return {
    hostOs: detectHostOs(),
    baseUrl: normalizeBaseUrl(option(options, "resolved-url", explicitBaseUrl(options))),
    tokenEnv: String(option(options, "token-env", DEFAULT_TOKEN_ENV)),
    codexBin: String(option(options, "codex-bin", process.env.CODEX_CLI_PATH || DEFAULT_CODEX_BIN)),
    claudeBin: String(option(options, "claude-bin", process.env.CLAUDE_CODE_CLI_PATH || DEFAULT_CLAUDE_BIN)),
    kiloBin: String(option(options, "kilo-bin", process.env.KILO_CLI_PATH || DEFAULT_KILO_BIN)),
    copilotBin: String(option(options, "copilot-bin", process.env.COPILOT_CLI_PATH || DEFAULT_COPILOT_BIN)),
    opencodeBin: String(option(options, "opencode-bin", process.env.OPENCODE_CLI_PATH || DEFAULT_OPENCODE_BIN)),
    orbBin: String(option(options, "orb-bin", process.env.ORB_CLI_PATH || DEFAULT_ORB_BIN)),
    dockerBin: String(option(options, "docker-bin", process.env.DOCKER_CLI_PATH || DEFAULT_DOCKER_BIN)),
    podmanBin: String(option(options, "podman-bin", process.env.PODMAN_CLI_PATH || DEFAULT_PODMAN_BIN)),
    nerdctlBin: String(option(options, "nerdctl-bin", process.env.NERDCTL_CLI_PATH || DEFAULT_NERDCTL_BIN)),
    wslBin: String(option(options, "wsl-bin", process.env.WSL_CLI_PATH || DEFAULT_WSL_BIN)),
    limaBin: String(option(options, "lima-bin", process.env.LIMA_CLI_PATH || DEFAULT_LIMA_BIN)),
    colimaBin: String(option(options, "colima-bin", process.env.COLIMA_CLI_PATH || DEFAULT_COLIMA_BIN)),
    multipassBin: String(option(options, "multipass-bin", process.env.MULTIPASS_CLI_PATH || DEFAULT_MULTIPASS_BIN)),
    lxcBin: String(option(options, "lxc-bin", process.env.LXC_CLI_PATH || DEFAULT_LXC_BIN)),
    incusBin: String(option(options, "incus-bin", process.env.INCUS_CLI_PATH || DEFAULT_INCUS_BIN)),
    vagrantBin: String(option(options, "vagrant-bin", process.env.VAGRANT_CLI_PATH || DEFAULT_VAGRANT_BIN)),
    parallelsBin: String(option(options, "parallels-bin", process.env.PARALLELS_CLI_PATH || DEFAULT_PARALLELS_BIN)),
    executionLocation: String(option(options, "execution-location", hasVmTarget ? "orb" : "local")),
    remoteKind: String(option(options, "remote-kind", "")),
    remoteId: String(option(options, "remote-id", "")),
    remoteName: String(option(options, "remote-name", "")),
    remoteBin: String(option(options, "remote-bin", "")),
    orbVm: String(option(options, "orb-vm", sharedVmName)),
    orbUser: String(option(options, "orb-user", sharedVmUser)),
    marketplaceRoot: path.resolve(String(option(options, "marketplace-root", path.join(os.homedir(), ".pact", "codex-plugin-marketplace")))),
    kiloConfigPath: path.resolve(String(option(options, "kilo-config", path.join(os.homedir(), ".config", "kilo", "kilo.json")))),
    antigravityConfigPath: path.resolve(String(option(options, "antigravity-config", path.join(os.homedir(), ".gemini", "antigravity", "mcp_config.json")))),
    opencodeConfigPath: path.resolve(String(option(options, "opencode-config", path.join(os.homedir(), ".config", "opencode", "opencode.jsonc")))),
    cursorConfigPath: path.resolve(String(option(options, "cursor-config", path.join(os.homedir(), "Library", "Application Support", "Cursor", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json")))),
    openclawVm: String(option(options, "openclaw-vm", sharedVmName)),
    openclawVmUser: String(option(options, "openclaw-user", sharedVmUser)),
    openclawBin: String(option(options, "openclaw-bin", "")),
    hermesVm: String(option(options, "hermes-vm", sharedVmName)),
    hermesVmUser: String(option(options, "hermes-user", sharedVmUser)),
    hermesBin: String(option(options, "hermes-bin", ""))
  };
}

function hasExplicitTarget(options) {
  return Object.hasOwn(options, "target");
}

function canUseInstallTui(options) {
  return !hasExplicitTarget(options)
    && !options.json
    && process.stdin.isTTY
    && process.stdout.isTTY;
}

function canUseUninstallTui(options) {
  return canUseInstallTui(options);
}

function statusGlyph(status) {
  if (status === "detected") {
    return "ok";
  }
  if (status === "not-detected") {
    return "--";
  }
  return "??";
}

function selectionGlyph(selected) {
  return selected ? "x" : " ";
}

function renderInstallMenu({ candidates, index, selectedIds, baseUrl, message = "", mode = "install" }) {
  const action = mode === "uninstall" ? "uninstall" : "install";
  const title = mode === "uninstall" ? msg("Pact MCP uninstall", "Pact MCP 卸载") : msg("Pact MCP install", "Pact MCP 安装");
  const mcpLine = baseUrl ? `MCP: ${baseUrl}/mcp` : msg("MCP: no server URL required for local client removal", "MCP: 本地卸载无需服务端 URL");
  const rows = [
    "\x1b[2J\x1b[H",
    title,
    "",
    mcpLine,
    msg(`Use Up/Down or j/k, Space to toggle, a to toggle detected, Enter to ${action}, q to cancel.`, `使用上下键或 j/k 移动，空格键选择/取消，按 a 全选检测到的客户端，Enter 键确认${action === "uninstall" ? "卸载" : "安装"}，q 键取消。`),
    "",
    ...candidates.map((candidate, candidateIndex) => {
      const pointer = candidateIndex === index ? ">" : " ";
      const selected = selectedIds.has(candidate.id);
      const label = `${candidate.label}`.padEnd(28, " ");
      const installed = candidate.installed ? msg("[installed] ", "[已安装] ") : "";
      return `${pointer} [${selectionGlyph(selected)}] ${installed}${label} ${candidate.detail || ""}`;
    }),
    "",
    message
  ];
  process.stdout.write(rows.join("\n"));
}
function renderAutoUpdateMenu({ enabled }) {
  const rows = [
    "\x1b[2J\x1b[H",
    msg("Pact MCP Auto-Update Preference", "Pact MCP 自动推送更新设置"),
    "",
    msg("Do you want to enable automatic push updates?", "您是否希望启用自动推送更新？"),
    msg("If enabled, your local AI agent will automatically download and install updates when the server pushes them.", "如果启用，当服务端推送更新时，您的本地 AI 智能体将自动下载并安装更新。"),
    msg("(This is disabled by default for security).", "（出于安全考虑，此功能默认禁用）。"),
    "",
    enabled
      ? msg("> [x] Enable automatic push updates", "> [x] 启用自动推送更新")
      : msg("  [ ] Enable automatic push updates", "  [ ] 启用自动推送更新"),
    enabled
      ? msg("  [ ] Disable automatic push updates (Recommended)", "  [ ] 禁用自动推送更新 (推荐)")
      : msg("> [x] Disable automatic push updates (Recommended)", "> [x] 禁用自动推送更新 (推荐)"),
    "",
    msg("Use Up/Down to toggle, Enter to confirm.", "使用上下键切换，Enter 键确认。")
  ];
  process.stdout.write(rows.join("\n") + "\n");
}

async function chooseAutoUpdate() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }
  let enabled = false;
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    const cleanup = () => {
      stdin.off("data", onData);
      if (stdin.setRawMode) {
        stdin.setRawMode(Boolean(wasRaw));
      }
      stdin.pause();
      process.stdout.write("\x1b[?25h\n");
    };
    
    renderAutoUpdateMenu({ enabled });
    
    const onData = (chunk) => {
      const key = chunk.toString("utf8");
      if (key === "\u0003") {
        cleanup();
        reject(new Error("Interactive install cancelled."));
        return;
      }
      if (key === "\r" || key === "\n") {
        cleanup();
        resolve(enabled);
        return;
      }
      if (key === "\u001b[A" || key === "k" || key === "K" || key === "\u001b[B" || key === "j" || key === "J" || key === " ") {
        enabled = !enabled;
        renderAutoUpdateMenu({ enabled });
      }
    };
    
    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.on("data", onData);
    process.stdout.write("\x1b[?25l");
  });
}

async function chooseInstallCandidates({ candidates, baseUrl }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive install requires a TTY. Pass --target for non-interactive use.");
  }
  let index = Math.max(0, candidates.findIndex((candidate) => candidate.status === "detected"));
  if (index < 0) {
    index = 0;
  }
  const selectedIds = new Set();
  let message = msg("Space selects one or more clients. Enter installs selected clients.", "空格键选择一个或多个客户端，Enter 键确认安装。");
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    const cleanup = () => {
      stdin.off("data", onData);
      if (stdin.setRawMode) {
        stdin.setRawMode(Boolean(wasRaw));
      }
      stdin.pause();
      process.stdout.write("\x1b[?25h\n");
    };
    const onData = (chunk) => {
      const key = chunk.toString("utf8");
      if (key === "\u0003") {
        cleanup();
        reject(new Error("Interactive install cancelled."));
        return;
      }
      if (key === "q" || key === "Q" || key === "\u001b") {
        cleanup();
        resolve(null);
        return;
      }
      if (key === "\r" || key === "\n") {
        const selected = candidates.filter((candidate) => selectedIds.has(candidate.id));
        if (selected.length === 0) {
          message = msg("No clients selected. Press Space to select at least one client.", "未选中任何客户端，请按空格键至少选择一个。");
          renderInstallMenu({ candidates, index, selectedIds, baseUrl, message });
          return;
        }
        cleanup();
        resolve(selected);
        return;
      }
      if (key === " ") {
        const selected = candidates[index];
        if (selectedIds.has(selected.id)) {
          selectedIds.delete(selected.id);
        } else {
          selectedIds.add(selected.id);
        }
        message = selectedIds.size === 1 ? msg("1 client selected.", "已选择 1 个客户端。") : msg(`${selectedIds.size} clients selected.`, `已选择 ${selectedIds.size} 个客户端。`);
      } else if (key === "a" || key === "A") {
        const detected = candidates.filter((candidate) => candidate.status === "detected");
        const shouldSelect = detected.some((candidate) => !selectedIds.has(candidate.id));
        for (const candidate of detected) {
          if (shouldSelect) {
            selectedIds.add(candidate.id);
          } else {
            selectedIds.delete(candidate.id);
          }
        }
        message = shouldSelect
          ? msg(`${detected.length} detected clients selected.`, `已选择检测到的 ${detected.length} 个客户端。`)
          : msg("Detected clients cleared.", "已清除选中的检测客户端。");
      }
      if (key === "\u001b[A" || key === "k" || key === "K") {
        index = (index - 1 + candidates.length) % candidates.length;
      } else if (key === "\u001b[B" || key === "j" || key === "J") {
        index = (index + 1) % candidates.length;
      }
      renderInstallMenu({ candidates, index, selectedIds, baseUrl, message });
    };
    process.stdout.write("\x1b[?25l");
    renderInstallMenu({ candidates, index, selectedIds, baseUrl, message });
    stdin.setEncoding("utf8");
    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function chooseUninstallCandidates({ candidates, baseUrl }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive uninstall requires a TTY. Pass --target for non-interactive use.");
  }
  let index = Math.max(0, candidates.findIndex((candidate) => candidate.status === "detected"));
  if (index < 0) {
    index = 0;
  }
  const selectedIds = new Set();
  let message = msg("Space selects one or more clients. Enter removes Pact MCP from selected clients.", "空格键选择一个或多个客户端，Enter 键确认移除所选客户端的 Pact MCP 服务。");
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    const cleanup = () => {
      stdin.off("data", onData);
      if (stdin.setRawMode) {
        stdin.setRawMode(Boolean(wasRaw));
      }
      stdin.pause();
      process.stdout.write("\x1b[?25h\n");
    };
    const onData = (chunk) => {
      const key = chunk.toString("utf8");
      if (key === "\u0003") {
        cleanup();
        reject(new Error("Interactive uninstall cancelled."));
        return;
      }
      if (key === "q" || key === "Q" || key === "\u001b") {
        cleanup();
        resolve(null);
        return;
      }
      if (key === "\r" || key === "\n") {
        const selected = candidates.filter((candidate) => selectedIds.has(candidate.id));
        if (selected.length === 0) {
          message = msg("No clients selected. Press Space to select at least one client.", "未选中任何客户端，请按空格键至少选择一个。");
          renderInstallMenu({ candidates, index, selectedIds, baseUrl, message, mode: "uninstall" });
          return;
        }
        cleanup();
        resolve(selected);
        return;
      }
      if (key === " ") {
        const selected = candidates[index];
        if (selectedIds.has(selected.id)) {
          selectedIds.delete(selected.id);
        } else {
          selectedIds.add(selected.id);
        }
        message = selectedIds.size === 1 ? msg("1 client selected for removal.", "已选择 1 个客户端用于移除。") : msg(`${selectedIds.size} clients selected for removal.`, `已选择 ${selectedIds.size} 个客户端用于移除。`);
      } else if (key === "a" || key === "A") {
        const detected = candidates.filter((candidate) => candidate.status === "detected");
        const shouldSelect = detected.some((candidate) => !selectedIds.has(candidate.id));
        for (const candidate of detected) {
          if (shouldSelect) {
            selectedIds.add(candidate.id);
          } else {
            selectedIds.delete(candidate.id);
          }
        }
        message = shouldSelect
          ? msg(`${detected.length} detected clients selected for removal.`, `已选择检测到的 ${detected.length} 个客户端用于移除。`)
          : msg("Detected clients cleared.", "已清除选中的检测客户端。");
      }
      if (key === "\u001b[A" || key === "k" || key === "K") {
        index = (index - 1 + candidates.length) % candidates.length;
      } else if (key === "\u001b[B" || key === "j" || key === "J") {
        index = (index + 1) % candidates.length;
      }
      renderInstallMenu({ candidates, index, selectedIds, baseUrl, message, mode: "uninstall" });
    };
    process.stdout.write("\x1b[?25l");
    renderInstallMenu({ candidates, index, selectedIds, baseUrl, message, mode: "uninstall" });
    stdin.setEncoding("utf8");
    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function promptLine(prompt, { hidden = false } = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive prompt requires a TTY.");
  }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let value = "";
    const cleanup = () => {
      stdin.off("data", onData);
      if (stdin.setRawMode) {
        stdin.setRawMode(Boolean(wasRaw));
      }
      stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk) => {
      const key = chunk.toString("utf8");
      if (key === "\u0003") {
        cleanup();
        reject(new Error("Interactive install cancelled."));
        return;
      }
      if (key === "\r" || key === "\n") {
        cleanup();
        resolve(value.trim());
        return;
      }
      if (key === "\u007f") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          if (!hidden) {
            process.stdout.write("\b \b");
          }
        }
        return;
      }
      if (key >= " ") {
        value += key;
        if (!hidden) {
          process.stdout.write(key);
        }
      }
    };
    process.stdout.write(prompt);
    stdin.setEncoding("utf8");
    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function resolveInteractiveToken(options) {
  const token = await resolveToken(options, { required: false });
  if (token) {
    return token;
  }
  const tokenEnv = String(option(options, "token-env", DEFAULT_TOKEN_ENV));
  const entered = await promptLine(`Pact MCP token (${tokenEnv}): `, { hidden: true });
  if (!entered) {
    throw new Error(`Missing token. Provide --token-stdin, --token, or ${tokenEnv}.`);
  }
  return entered;
}

async function requestLocalMcpGrant(options, { targets = [], autoUpdate = false } = {}) {
  const settings = installerOptions(options);
  const targetList = [...new Set(targets.map(normalizeTarget).filter(Boolean))];
  const response = await fetchJson(`${settings.baseUrl}/api/mcp/local-grant`, {
    method: "POST",
    timeoutMs: 10000,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      targets: targetList,
      label: `Pact MCP ${targetList.length ? targetList.map(targetLabel).join(", ") : "local agent"}`,
      connectorVersion: packageJson.version,
      autoUpdate
    })
  });
  if (!response.ok || !response.payload?.token) {
    const reason = response.payload?.error?.message || response.payload?.error || `HTTP ${response.status}`;
    throw new Error(`Failed to request local Pact MCP token: ${reason}`);
  }
  return {
    token: String(response.payload.token || "").trim(),
    source: "local-grant",
    grant: response.payload.grant || null,
    tokenPrefix: response.payload.tokenPrefix || response.payload.grant?.tokenPrefix || "",
    toolsets: response.payload.toolsets || [],
    scopes: response.payload.scopes || []
  };
}

async function notifyLocalMcpUninstall(options, { targets = [] } = {}) {
  const settings = installerOptions(options);
  const targetList = [...new Set(targets.map(normalizeTarget).filter(Boolean))];
  if (!settings.baseUrl || targetList.length === 0) {
    return { ok: true, skipped: true, targets: targetList };
  }
  const response = await fetchJson(`${settings.baseUrl}/api/mcp/local-uninstall`, {
    method: "POST",
    timeoutMs: 10000,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      targets: targetList,
      connectorVersion: packageJson.version
    })
  });
  if (!response.ok || response.payload?.ok === false) {
    const reason = response.payload?.error?.message || response.payload?.error || `HTTP ${response.status}`;
    throw new Error(`Failed to update Pact MCP device list after uninstall: ${reason}`);
  }
  return response.payload || { ok: true, targets: targetList };
}

async function resolveInstallToken(options, { targets = [], autoUpdate = false } = {}) {
  const explicit = await resolveToken(options, { required: false });
  if (explicit) {
    return {
      token: explicit,
      source: "provided",
      tokenPrefix: redactToken(explicit)
    };
  }
  if (options["no-auto-token"]) {
    const tokenEnv = String(option(options, "token-env", DEFAULT_TOKEN_ENV));
    throw new Error(`Missing token. Provide --token-stdin, --token, or ${tokenEnv}.`);
  }
  return requestLocalMcpGrant(options, { targets, autoUpdate });
}

async function resolveHubForInstall(options) {
  const discovered = await discoverPactHub(options);
  if (discovered.ok) {
    return {
      ...options,
      "resolved-url": discovered.baseUrl,
      __pactDiscovery: discovered
    };
  }
  if (!canUseInstallTui(options)) {
    throw new Error(`${discovered.reason} Run pact-mcp server-config --set --url <pact-url>, or rerun install in a TTY and choose manual configuration.`);
  }
  console.log("No signed Pact MCP service was discovered on this device.");
  console.log("The installer will not write any agent client config until a server identity signature is verified.");
  console.log("");
  const answer = await promptLine("Choose: [c]onfigure server URL now, [s]kip, manually configure later [s]: ");
  if (!answer || answer.toLowerCase().startsWith("s")) {
    return {
      ...options,
      __pactSkippedDiscovery: {
        ok: false,
        skipped: true,
        attempts: discovered.attempts,
        reason: "Skipped. Manually configure later with pact-mcp server-config --set --url <pact-url>."
      }
    };
  }
  if (!answer.toLowerCase().startsWith("c")) {
    return resolveHubForInstall(options);
  }
  const url = await promptLine("Pact server URL: ");
  const manual = await discoverPactHub({ ...options, url });
  if (!manual.ok) {
    throw new Error(`Failed to verify ${url}: ${manual.reason}`);
  }
  await writeServerConfigProfile({
    options: { ...options, url },
    name: String(option(options, "name", "manual")).trim() || "manual",
    discovered: manual,
    publishEnv: !options["no-env"]
  });
  return {
    ...options,
    "resolved-url": manual.baseUrl,
    __pactDiscovery: manual
  };
}

function remoteContextFromSettings(settings) {
  const kind = settings.remoteKind || settings.executionLocation;
  if (!isGenericRemoteLocation(kind)) {
    return null;
  }
  const remoteBins = {
    docker: settings.dockerBin,
    podman: settings.podmanBin,
    nerdctl: settings.nerdctlBin,
    wsl: settings.wslBin,
    lima: settings.limaBin,
    colima: settings.colimaBin,
    multipass: settings.multipassBin,
    lxc: settings.lxcBin,
    incus: settings.incusBin,
    vagrant: settings.vagrantBin,
    parallels: settings.parallelsBin
  };
  const bin = settings.remoteBin
    || remoteBins[kind]
    || "";
  if (!settings.remoteId || !bin) {
    throw new Error(`${kind} install requires a discovered remote context.`);
  }
  return {
    kind,
    id: settings.remoteId,
    name: settings.remoteName || settings.remoteId,
    bin
  };
}

async function installTargets({ options, targets, token, tokenInfo = null, optionOverrides = {} }) {
  const mergedOptions = {
    ...options,
    ...optionOverrides
  };
  const settings = installerOptions(mergedOptions);
  const remoteContext = remoteContextFromSettings(settings);
  const verify = !mergedOptions["no-verify"];

  await ensureService(settings.baseUrl);

  const installed = {};
  for (const target of targets) {
    try {
      let clientResult = null;
      if (target === "codex") {
        clientResult = remoteContext
          ? await installCodexRemote({
              baseUrl: settings.baseUrl,
              token,
              tokenEnv: settings.tokenEnv,
              context: remoteContext,
              codexBin: settings.codexBin
            })
          : settings.executionLocation === "orb"
          ? await installCodexOrb({
              baseUrl: settings.baseUrl,
              token,
              tokenEnv: settings.tokenEnv,
              orbBin: settings.orbBin,
              vmName: settings.orbVm,
              vmUser: settings.orbUser,
              codexBin: settings.codexBin
            })
          : await installCodex({
              baseUrl: settings.baseUrl,
              token,
              tokenEnv: settings.tokenEnv,
              codexBin: settings.codexBin,
              marketplaceRoot: settings.marketplaceRoot
            });
      } else if (target === "claude-code") {
        clientResult = remoteContext
          ? await installClaudeCodeRemote({
              baseUrl: settings.baseUrl,
              token,
              context: remoteContext,
              claudeBin: settings.claudeBin
            })
          : settings.executionLocation === "orb"
          ? await installClaudeCodeOrb({
              baseUrl: settings.baseUrl,
              token,
              orbBin: settings.orbBin,
              vmName: settings.orbVm,
              vmUser: settings.orbUser,
              claudeBin: settings.claudeBin
            })
          : await installClaudeCode({
              baseUrl: settings.baseUrl,
              token,
              claudeBin: settings.claudeBin
            });
      } else if (target === "kilo-code") {
        clientResult = remoteContext
          ? await installKiloRemote({
              baseUrl: settings.baseUrl,
              token,
              context: remoteContext,
              kiloBin: settings.kiloBin
            })
          : settings.executionLocation === "orb"
          ? await installKiloOrb({
              baseUrl: settings.baseUrl,
              token,
              orbBin: settings.orbBin,
              vmName: settings.orbVm,
              vmUser: settings.orbUser,
              kiloBin: settings.kiloBin
            })
          : await installKilo({
              baseUrl: settings.baseUrl,
              token,
              kiloBin: settings.kiloBin,
              kiloConfigPath: settings.kiloConfigPath
            });
      } else if (target === "copilot") {
        clientResult = remoteContext
          ? await installCopilotRemote({
              baseUrl: settings.baseUrl,
              token,
              context: remoteContext,
              copilotBin: settings.copilotBin
            })
          : settings.executionLocation === "orb"
          ? await installCopilotOrb({
              baseUrl: settings.baseUrl,
              token,
              orbBin: settings.orbBin,
              vmName: settings.orbVm,
              vmUser: settings.orbUser,
              copilotBin: settings.copilotBin
            })
          : await installCopilot({
              baseUrl: settings.baseUrl,
              token,
              copilotBin: settings.copilotBin
            });
      } else if (target === "openclaw") {
        clientResult = remoteContext
          ? await installOpenClawRemote({
              baseUrl: settings.baseUrl,
              token,
              context: remoteContext,
              openclawBin: settings.openclawBin
            })
          : await installOpenClaw({
              baseUrl: settings.baseUrl,
              token,
              orbBin: settings.orbBin,
              vmName: settings.openclawVm || settings.orbVm,
              vmUser: settings.openclawVmUser || settings.orbUser,
              openclawBin: settings.openclawBin
            });
      } else if (target === "hermes") {
        clientResult = remoteContext
          ? await installHermesRemote({
              baseUrl: settings.baseUrl,
              token,
              context: remoteContext,
              hermesBin: settings.hermesBin
            })
          : await installHermes({
              baseUrl: settings.baseUrl,
              token,
              orbBin: settings.orbBin,
              vmName: settings.hermesVm,
              vmUser: settings.hermesVmUser,
              hermesBin: settings.hermesBin
            });
      } else if (target === "antigravity") {
        clientResult = await installAntigravity({
          baseUrl: settings.baseUrl,
          token,
          configPath: settings.antigravityConfigPath
        });
      } else if (target === "cursor") {
        clientResult = await installMcpServersJsonConfig({
          baseUrl: settings.baseUrl,
          token,
          configPath: settings.cursorConfigPath,
          installMode: "cursor-release-mcp-config"
        });
      } else if (target === "opencode") {
        clientResult = remoteContext
          ? await installOpenCodeRemote({
              baseUrl: settings.baseUrl,
              token,
              context: remoteContext
            })
          : settings.executionLocation === "orb"
          ? await installOpenCodeOrb({
              baseUrl: settings.baseUrl,
              token,
              orbBin: settings.orbBin,
              vmName: settings.orbVm,
              vmUser: settings.orbUser
            })
          : await installOpenCode({
              baseUrl: settings.baseUrl,
              token,
              configPath: settings.opencodeConfigPath
            });
      }
      const httpVerification = verify ? await verifyMcpTools({ baseUrl: settings.baseUrl, token }) : null;
      installed[target] = {
        ok: true,
        status: "installed",
        ...(clientResult || {}),
        httpVerification
      };
    } catch (error) {
      installed[target] = {
        ok: false,
        status: "failed",
        installMode: targetInstallMode(target),
        error: redactSensitiveText(error?.message || String(error), [token])
      };
    }
  }

  const discoveryManifest = await writeDeviceDiscovery({
    baseUrl: settings.baseUrl,
    marketplaceRoot: settings.marketplaceRoot,
    codexPluginRoot: installed.codex?.pluginRoot || "",
    installed,
    token,
    tokenEnv: settings.tokenEnv,
    discoveryPath: discoveryRegistryPath(mergedOptions)
  });

  return {
    ok: Object.values(installed).every((value) => value?.ok !== false),
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    targets,
    baseUrl: settings.baseUrl,
    discoveryManifest,
    installed: Object.fromEntries(Object.entries(installed).map(([target, value]) => [
      target,
      {
        installMode: value.installMode,
        status: value.status || (value.ok === false ? "failed" : "installed"),
        error: value.error || "",
        tokenSource: tokenInfo?.source || "provided",
        tokenPrefix: tokenInfo?.tokenPrefix || redactToken(token),
        httpVerification: value.httpVerification || null
      }
    ]))
  };
}

async function installTuiCommand(options) {
  const settings = installerOptions(options);
  await ensureService(settings.baseUrl);
  const scan = await scanInstallTargets(options);
  const selected = await chooseInstallCandidates({
    candidates: scan.candidates,
    baseUrl: settings.baseUrl
  });
  if (!selected || selected.length === 0) {
    return {
      ok: false,
      cancelled: true,
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      reason: "Interactive install cancelled."
    };
  }
  const selectedTargets = [...new Set(selected.map((candidate) => candidate.target))];
  const autoUpdate = await chooseAutoUpdate();
  options.__pactAutoUpdate = autoUpdate;
  const tokenInfo = await resolveInstallToken(options, { targets: selectedTargets, autoUpdate });
  const hasPerCandidateOverrides = selected.some((candidate) =>
    Object.keys(candidate.optionOverrides || {}).length > 0
  );
  const result = hasPerCandidateOverrides
    ? await installSelectedCandidates({ options, selected, tokenInfo })
    : await installTargets({
        options,
        targets: selectedTargets,
        token: tokenInfo.token,
        tokenInfo
      });
  return {
    ...result,
    interactive: true,
    selected: selected.map((candidate) => ({
      id: candidate.id,
      target: candidate.target,
      label: candidate.label,
      detail: candidate.detail
    }))
  };
}

async function installSelectedCandidates({ options, selected, tokenInfo }) {
  const partials = [];
  let discoveryManifest = "";
  let baseUrl = installerOptions(options).baseUrl;
  const installed = {};
  for (const candidate of selected) {
    const partial = await installTargets({
      options,
      targets: [candidate.target],
      token: tokenInfo.token,
      tokenInfo,
      optionOverrides: candidate.optionOverrides || {}
    });
    partials.push({
      target: candidate.target,
      id: candidate.id,
      label: candidate.label,
      ok: partial.ok,
      discoveryManifest: partial.discoveryManifest
    });
    discoveryManifest = partial.discoveryManifest;
    baseUrl = partial.baseUrl || baseUrl;
    Object.assign(installed, partial.installed || {});
  }
  return {
    ok: partials.every((partial) => partial.ok),
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    targets: [...new Set(selected.map((candidate) => candidate.target))],
    baseUrl,
    discoveryManifest,
    installed,
    partials
  };
}

function summarizeInstallCandidate(candidate) {
  return {
    id: candidate.id,
    target: candidate.target,
    label: candidate.label,
    detail: candidate.detail || "",
    ...(candidate.mcpProbe ? { mcpProbe: candidate.mcpProbe } : {}),
    installed: Boolean(candidate.installed),
    installCommand: candidate.installCommand || "",
    repairCommand: candidate.repairCommand || "",
    doctorCommand: candidate.doctorCommand || "pact-mcp doctor --json"
  };
}

function noDetectedClientGuidance(candidates = [], options = {}) {
  const explicitTargets = candidates
    .map((candidate) => candidate.target)
    .filter((target, index, values) => target && values.indexOf(target) === index);
  const priorityTargets = PRIORITY_INSTALL_TARGETS.filter((target) => explicitTargets.includes(target));
  const suggestedTarget = priorityTargets[0] || explicitTargets[0] || "codex";
  const binOption = targetBinOption(suggestedTarget);
  const { baseUrl, tokenEnv } = commandGuidanceContext(options);
  const includeUrl = Boolean(baseUrl);
  const scanCommand = shellCommandForScan({ includeUrl, baseUrl, tokenEnv });
  return {
    errorCode: "NO_SUPPORTED_MCP_CLIENTS_DETECTED",
    nextCommand: scanCommand,
    repairCommands: [
      scanCommand,
      shellCommandForInstall({ target: suggestedTarget, binOption, includeUrl, baseUrl, tokenEnv }),
      shellCommandForInstall({ target: "auto", includeUrl, baseUrl, tokenEnv })
    ],
    ...installGuidanceMetadata({ includeUrl, baseUrl, tokenEnv })
  };
}

async function installAutoDetectedCommand(resolvedOptions) {
  const scan = await scanInstallTargets(resolvedOptions);
  const selected = scan.candidates.filter((candidate) => candidate.status === "detected");
  const candidates = scan.candidates.map(summarizeInstallCandidate);
  if (selected.length === 0) {
    return {
      ok: false,
      autoDetected: true,
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      baseUrl: installerOptions(resolvedOptions).baseUrl,
      error: "No supported MCP clients were detected. Pass --target <client>, --target auto with an explicit --<client>-bin, or run in a TTY for selection.",
      ...noDetectedClientGuidance(candidates, resolvedOptions),
      candidates
    };
  }
  const autoUpdate = Boolean(resolvedOptions["auto-update"]);
  resolvedOptions.__pactAutoUpdate = autoUpdate;
  const selectedTargets = [...new Set(selected.map((candidate) => candidate.target))];
  const tokenInfo = await resolveInstallToken(resolvedOptions, { targets: selectedTargets, autoUpdate });
  const result = await installSelectedCandidates({ options: resolvedOptions, selected, tokenInfo });
  return {
    ...result,
    autoDetected: true,
    selected: selected.map(summarizeInstallCandidate)
  };
}

async function installCommand(options) {
  const initialTargetOpt = option(options, "target", "");
  const prevalidatedTargets = initialTargetOpt && !isAutoTargetRequest(initialTargetOpt)
    ? parseTargets(initialTargetOpt)
    : null;
  const resolvedOptions = await resolveHubForInstall(options);
  if (resolvedOptions.__pactSkippedDiscovery) {
    return {
      ok: false,
      skipped: true,
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      ...resolvedOptions.__pactSkippedDiscovery
    };
  }
  if (canUseInstallTui(options)) {
    return installTuiCommand(resolvedOptions);
  }
  const targetOpt = option(resolvedOptions, "target", "");
  if (!targetOpt) {
    return installAutoDetectedCommand(resolvedOptions);
  }
  if (isAutoTargetRequest(targetOpt)) {
    return installAutoDetectedCommand(resolvedOptions);
  }
  const targets = prevalidatedTargets || parseTargets(targetOpt);
  const autoUpdate = Boolean(resolvedOptions["auto-update"]);
  resolvedOptions.__pactAutoUpdate = autoUpdate;
  const tokenInfo = await resolveInstallToken(resolvedOptions, { targets, autoUpdate });
  return installTargets({
    options: resolvedOptions,
    targets,
    token: tokenInfo.token,
    tokenInfo
  });
}

async function optionsWithStoredBaseUrl(options = {}) {
  if (explicitBaseUrl(options) || option(options, "resolved-url", "")) {
    return options;
  }
  const [storedBaseUrl] = await registryBaseUrls(options);
  return storedBaseUrl
    ? { ...options, "resolved-url": storedBaseUrl }
    : options;
}

async function uninstallTargets({ options, targets, optionOverrides = {} }) {
  const mergedOptions = {
    ...options,
    ...optionOverrides
  };
  const settings = installerOptions(mergedOptions);
  const remoteContext = remoteContextFromSettings(settings);
  const uninstalled = {};
  for (const target of targets) {
    try {
      if (target === "codex") {
        uninstalled[target] = remoteContext
          ? await uninstallCodexRemote({
              context: remoteContext,
              codexBin: settings.codexBin
            })
          : settings.executionLocation === "orb"
          ? await uninstallCodexOrb({
              orbBin: settings.orbBin,
              vmName: settings.orbVm,
              vmUser: settings.orbUser,
              codexBin: settings.codexBin
            })
          : await uninstallCodex({
              tokenEnv: settings.tokenEnv,
              codexBin: settings.codexBin,
              marketplaceRoot: settings.marketplaceRoot
            });
      } else if (target === "claude-code") {
        uninstalled[target] = remoteContext
          ? await uninstallClaudeCodeRemote({
              context: remoteContext,
              claudeBin: settings.claudeBin
            })
          : settings.executionLocation === "orb"
          ? await uninstallClaudeCodeOrb({
              orbBin: settings.orbBin,
              vmName: settings.orbVm,
              vmUser: settings.orbUser,
              claudeBin: settings.claudeBin
            })
          : await uninstallClaudeCode({
              claudeBin: settings.claudeBin
            });
      } else if (target === "kilo-code") {
        uninstalled[target] = remoteContext
          ? await uninstallKiloRemote({
              context: remoteContext,
              kiloBin: settings.kiloBin
            })
          : settings.executionLocation === "orb"
          ? await uninstallKiloOrb({
              orbBin: settings.orbBin,
              vmName: settings.orbVm,
              vmUser: settings.orbUser,
              kiloBin: settings.kiloBin
            })
          : await uninstallKilo({
              kiloConfigPath: settings.kiloConfigPath,
              kiloBin: settings.kiloBin
            });
      } else if (target === "copilot") {
        uninstalled[target] = remoteContext
          ? await uninstallCopilotRemote({
              context: remoteContext,
              copilotBin: settings.copilotBin
            })
          : settings.executionLocation === "orb"
          ? await uninstallCopilotOrb({
              orbBin: settings.orbBin,
              vmName: settings.orbVm,
              vmUser: settings.orbUser,
              copilotBin: settings.copilotBin
            })
          : await uninstallCopilot({
              copilotBin: settings.copilotBin
            });
      } else if (target === "openclaw") {
        uninstalled[target] = remoteContext
          ? await uninstallOpenClawRemote({
              context: remoteContext,
              openclawBin: settings.openclawBin
            })
          : await uninstallOpenClaw({
              orbBin: settings.orbBin,
              vmName: settings.openclawVm || settings.orbVm,
              vmUser: settings.openclawVmUser || settings.orbUser,
              openclawBin: settings.openclawBin
            });
      } else if (target === "hermes") {
        uninstalled[target] = remoteContext
          ? await uninstallHermesRemote({
              context: remoteContext,
              hermesBin: settings.hermesBin
            })
          : await uninstallHermes({
              orbBin: settings.orbBin,
              vmName: settings.hermesVm,
              vmUser: settings.hermesVmUser,
              hermesBin: settings.hermesBin
            });
      } else if (target === "antigravity") {
        uninstalled[target] = await uninstallAntigravity({
          configPath: settings.antigravityConfigPath
        });
      } else if (target === "cursor") {
        uninstalled[target] = await uninstallMcpServersJsonConfig({
          configPath: settings.cursorConfigPath,
          uninstallMode: "cursor-release-mcp-config"
        });
      } else if (target === "opencode") {
        uninstalled[target] = remoteContext
          ? await uninstallOpenCodeRemote({
              context: remoteContext
            })
          : settings.executionLocation === "orb"
          ? await uninstallOpenCodeOrb({
              orbBin: settings.orbBin,
              vmName: settings.orbVm,
              vmUser: settings.orbUser
            })
          : await uninstallOpenCode({
              configPath: settings.opencodeConfigPath
            });
      }
      uninstalled[target] = {
        ok: true,
        status: "not-installed",
        ...(uninstalled[target] || {})
      };
    } catch (error) {
      uninstalled[target] = {
        ok: false,
        status: "failed",
        uninstallMode: targetInstallMode(target),
        error: redactSensitiveText(error?.message || String(error), sensitiveOptionValues(mergedOptions))
      };
    }
  }
  const discoveryManifest = settings.baseUrl
    ? await writeDeviceUninstall({
        baseUrl: settings.baseUrl,
        uninstalled,
        tokenEnv: Object.hasOwn(mergedOptions, "token-env") ? settings.tokenEnv : "",
        discoveryPath: discoveryRegistryPath(mergedOptions)
      })
    : "";
  const successfulTargets = targets.filter((target) => uninstalled[target]?.ok !== false);
  let serverUninstall = null;
  if (settings.baseUrl && successfulTargets.length > 0) {
    try {
      serverUninstall = await notifyLocalMcpUninstall(mergedOptions, { targets: successfulTargets });
      for (const target of successfulTargets) {
        uninstalled[target] = {
          ...uninstalled[target],
          serverDeviceRemoved: true
        };
      }
    } catch (error) {
      serverUninstall = {
        ok: false,
        error: redactSensitiveText(error?.message || String(error), sensitiveOptionValues(mergedOptions))
      };
      for (const target of successfulTargets) {
        uninstalled[target] = {
          ...uninstalled[target],
          ok: false,
          status: "failed",
          serverDeviceRemoved: false,
          error: redactSensitiveText(error?.message || String(error), sensitiveOptionValues(mergedOptions))
        };
      }
    }
  }
  return {
    ok: Object.values(uninstalled).every((value) => value?.ok !== false),
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    targets,
    baseUrl: settings.baseUrl,
    discoveryManifest,
    serverUninstall,
    uninstalled
  };
}

async function uninstallSelectedCandidates({ options, selected }) {
  const partials = [];
  let discoveryManifest = "";
  let baseUrl = installerOptions(options).baseUrl;
  const uninstalled = {};
  for (const candidate of selected) {
    const partial = await uninstallTargets({
      options,
      targets: [candidate.target],
      optionOverrides: candidate.optionOverrides || {}
    });
    partials.push({
      target: candidate.target,
      id: candidate.id,
      label: candidate.label,
      ok: partial.ok,
      discoveryManifest: partial.discoveryManifest
    });
    discoveryManifest = partial.discoveryManifest || discoveryManifest;
    baseUrl = partial.baseUrl || baseUrl;
    Object.assign(uninstalled, partial.uninstalled || {});
  }
  return {
    ok: partials.every((partial) => partial.ok),
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    targets: [...new Set(selected.map((candidate) => candidate.target))],
    baseUrl,
    discoveryManifest,
    uninstalled,
    partials
  };
}

async function waitAnyKey(promptText) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return;
  }
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    const cleanup = () => {
      stdin.off("data", onData);
      if (stdin.setRawMode) {
        stdin.setRawMode(Boolean(wasRaw));
      }
      stdin.pause();
      process.stdout.write("\n");
      resolve();
    };
    const onData = () => cleanup();
    process.stdout.write(promptText);
    stdin.setEncoding("utf8");
    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function uninstallTuiCommand(options) {
  const settings = installerOptions(options);
  const scan = await scanInstallTargets(options);
  
  const manifestPath = discoveryRegistryPath(options);
  const manifest = await readJson(manifestPath, null);
  let installedTargets = [];
  if (manifest) {
    const server = manifest.servers?.[MCP_SERVER_NAME] || {};
    installedTargets = Object.entries(server.targets || {})
      .filter(([, status]) => status?.status === "installed")
      .map(([target]) => target);
  }
  
  const filteredCandidates = scan.candidates.filter(c => installedTargets.includes(c.target));
  
  if (filteredCandidates.length === 0) {
    console.log(`\x1b[2J\x1b[HPact MCP uninstall\n`);
    console.log(`Scanned ${scan.candidates.length} supported MCP clients.`);
    console.log("None of these clients currently have Pact MCP installed.");
    await waitAnyKey("\nPress any key to escape...");
    return {
      ok: true,
      cancelled: true,
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      reason: "No installed Pact MCP clients found to uninstall."
    };
  }

  const selected = await chooseUninstallCandidates({
    candidates: filteredCandidates,
    baseUrl: settings.baseUrl
  });
  if (!selected || selected.length === 0) {
    return {
      ok: false,
      cancelled: true,
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      reason: "Interactive uninstall cancelled."
    };
  }
  const result = await uninstallSelectedCandidates({ options, selected });
  return {
    ...result,
    interactive: true,
    selected: selected.map((candidate) => ({
      id: candidate.id,
      target: candidate.target,
      label: candidate.label,
      detail: candidate.detail
    }))
  };
}

async function uninstallCommand(options) {
  const resolvedOptions = await optionsWithStoredBaseUrl(options);
  if (canUseUninstallTui(options)) {
    return uninstallTuiCommand(resolvedOptions);
  }
  const targetOpt = option(resolvedOptions, "target", "");
  if (!targetOpt) {
    return {
      ok: false,
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      error: "Interactive mode requires a TTY. Please specify --target <client> for non-interactive use."
    };
  }
  const targets = parseTargets(targetOpt);
  return uninstallTargets({
    options: resolvedOptions,
    targets
  });
}

async function registerCommand(options) {
  const resolvedOptions = await optionsWithDiscoveredBaseUrl(options);
  const settings = installerOptions(resolvedOptions);
  const parsedBaseUrl = new URL(settings.baseUrl);
  const port = parsedBaseUrl.port || (parsedBaseUrl.protocol === "https:" ? "443" : "80");
  const mcpUrl = `${settings.baseUrl}/mcp`;
  const vmMcpUrl = `${parsedBaseUrl.protocol}//host.orb.internal:${port}/mcp`;
  const profile = await writeServerConfigProfile({
    options: resolvedOptions,
    name: String(option(resolvedOptions, "name", "default")).trim() || "default",
    discovered: resolvedOptions.__pactDiscovery,
    publishEnv: !resolvedOptions["no-env"]
  });
  const discoveryManifest = profile.path;
  const localFiles = deviceDiscoveryPaths(resolvedOptions);
  const env = deviceDiscoveryEnv({ baseUrl: settings.baseUrl, primaryPath: discoveryManifest });
  const tokenEnv = profile.tokenEnv || settings.tokenEnv;
  const includeUrl = Boolean(settings.baseUrl);
  const guidance = installGuidanceMetadata({ includeUrl, baseUrl: settings.baseUrl, tokenEnv });
  return {
    ok: true,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    mode: "device-hub-registration",
    baseUrl: settings.baseUrl,
    mcpUrl,
    sharedHub: sharedHubContract({ mcpUrl, vmMcpUrl }),
    discoveryManifest,
    localEntry: {
      command: shellCommandForDiscoverLocal({ includeUrl: Boolean(settings.baseUrl), baseUrl: settings.baseUrl }),
      registryFile: discoveryManifest
    },
    localFiles,
    env,
    ...guidance,
    clientInstall: guidance.clientInstallJsonCommand,
    autoInstall: guidance.autoInstallCommand,
    priorityInstall: guidance.priorityInstallCommand,
    verifiedHandshake: resolvedOptions.__pactDiscovery?.handshake?.payload?.identity?.keyId || "",
    serverConfig: profile.profile,
    note: "Discovered and registered the signed Pact MCP endpoint without installing it into any client."
  };
}

async function readLocalDiscoveryFile(filePath) {
  const payload = await readJson(filePath, null);
  const server = payload?.servers?.[MCP_SERVER_NAME] || {};
  if (!server.httpUrl) {
    return null;
  }
  return {
    sourceType: "file",
    source: filePath,
    payload,
    mcpUrl: server.httpUrl,
    discoveryUrl: server.discoveryUrl || payload.discovery?.preferredHttpDiscoveryUrl || ""
  };
}

async function fetchDiscoveryUrl(url) {
  const response = await fetchJson(url);
  if (!response.ok) {
    return null;
  }
  const server = response.payload?.mcpServers?.[MCP_SERVER_NAME] || response.payload?.servers?.[MCP_SERVER_NAME] || {};
  const mcpUrl = server.httpUrl || server.url || "";
  if (!mcpUrl) {
    return null;
  }
  return {
    sourceType: "http",
    source: url,
    payload: response.payload,
    mcpUrl,
    discoveryUrl: url
  };
}

async function discoverLocalCommand(options) {
  const discovered = await discoverPactHub(options);
  if (!discovered.ok) {
    return {
      ok: false,
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      attempts: discovered.attempts,
      reason: discovered.reason
    };
  }
  return {
    ok: true,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    sourceType: "signed-handshake",
    source: discovered.baseUrl,
    baseUrl: discovered.baseUrl,
    mcpUrl: `${discovered.baseUrl}/mcp`,
    discoveryUrl: `${discovered.baseUrl}/api/mcp/discovery`,
    identityKeyId: discovered.handshake?.payload?.identity?.keyId || "",
    attempts: discovered.attempts,
    payload: discovered.discovery
  };
}

async function doctorCommand(options) {
  const resolvedOptions = await optionsWithDiscoveredBaseUrl(options);
  const settings = installerOptions(resolvedOptions);
  const discovered = resolvedOptions.__pactDiscovery || null;
  const token = await resolveToken(resolvedOptions, { required: false });
  const discovery = await fetchJson(`${settings.baseUrl}/api/mcp/discovery`);
  const initialize = await ensureService(settings.baseUrl);
  const initializeMeta = initialize.payload?.result?._meta || {};
  const initializeSupportedTargets = Array.isArray(initializeMeta.supportedTargets)
    ? initializeMeta.supportedTargets.map((target) => target.target).filter(Boolean)
    : [];
  const checks = {
    signedDiscovery: {
      ok: Boolean(discovered?.ok),
      baseUrl: settings.baseUrl,
      identityKeyId: discovered?.handshake?.payload?.identity?.keyId || "",
      attempts: discovered?.attempts || []
    },
    discovery: {
      ok: discovery.ok,
      status: discovery.status,
      installerPackage: discovery.payload?.installer?.packageName || "",
      httpUrl: discovery.payload?.mcpServers?.pact?.httpUrl || ""
    },
    initialize: {
      ok: true,
      serverName: initialize.payload?.result?.serverInfo?.name || "",
      serverVersion: initialize.payload?.result?.serverInfo?.version || "",
      stableToolName: initialize.payload?.result?._meta?.stableToolName || "",
      listChanged: initialize.payload?.result?.capabilities?.tools?.listChanged === true,
      sharedHubOk: initializeMeta.sharedHub?.sharedspace?.outlet === "pact.sharedspace",
      sharedHub: initializeMeta.sharedHub || discovery.payload?.sharedHub || null,
      priorityTargets: Array.isArray(initializeMeta.priorityTargets) ? initializeMeta.priorityTargets : [],
      supportedTargets: initializeSupportedTargets
    },
    toolsList: {
      ok: false,
      skipped: true,
      toolCount: 0,
      stableOutletSet: false,
      reason: "Set PACT_MCP_TOKEN, pass --token, or use --token-stdin to verify tools/list."
    },
    systemHealth: {
      ok: false,
      skipped: true,
      healthy: false,
      reason: "Set PACT_MCP_TOKEN, pass --token, or use --token-stdin to verify tools/call system.health."
    },
    deviceManifest: {
      ok: false,
      exists: false,
      path: discoveryRegistryPath(resolvedOptions)
    }
  };

  if (token) {
    try {
      const verification = await verifyMcpTools({ baseUrl: settings.baseUrl, token });
      checks.toolsList = {
        ok: verification.toolCount === 7 && verification.stableToolName === "pact.discovery",
        skipped: false,
        toolCount: verification.toolCount,
        stableOutletSet: verification.toolCount === 7,
        categorizedOutletsOnly: verification.toolCount === 7,
        sharedHubOk: verification.sharedHubOk,
        priorityTargets: verification.priorityTargets,
        supportedTargets: verification.supportedTargets
      };
      checks.systemHealth = {
        ok: verification.systemHealthOk,
        skipped: false,
        healthy: verification.systemHealthOk,
        operation: "system.health"
      };
    } catch (error) {
      const reason = error?.message || String(error);
      checks.toolsList = {
        ok: false,
        skipped: false,
        toolCount: 0,
        stableOutletSet: false,
        categorizedOutletsOnly: false,
        reason
      };
      checks.systemHealth = {
        ok: false,
        skipped: false,
        healthy: false,
        operation: "system.health",
        reason
      };
    }
  }

  const manifestPath = checks.deviceManifest.path;
  const manifest = await readJson(manifestPath, null);
  if (manifest) {
    const server = manifest.servers?.[MCP_SERVER_NAME] || {};
    checks.deviceManifest = {
      ok: true,
      exists: true,
      path: manifestPath,
      httpUrl: server.httpUrl || "",
      connector: server.connector || null,
      installedTargets: Object.entries(server.targets || {})
        .filter(([, status]) => status?.status === "installed")
        .map(([target]) => target)
    };
  }

  const guidance = doctorGuidance(checks, resolvedOptions);
  const { baseUrl, tokenEnv } = commandGuidanceContext(resolvedOptions);
  const includeUrl = Boolean(baseUrl);
  return {
    ok: checks.signedDiscovery.ok
      && checks.discovery.ok
      && checks.initialize.ok
      && (!token || (checks.toolsList.ok && checks.systemHealth.ok)),
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    sharedHub: checks.initialize.sharedHub,
    ...installGuidanceMetadata({ includeUrl, baseUrl, tokenEnv }),
    ...guidance,
    checks
  };
}

async function discoverCommand(options) {
  const resolvedOptions = await optionsWithDiscoveredBaseUrl(options);
  const baseUrl = installerOptions(resolvedOptions).baseUrl;
  const discovery = await fetchJson(`${baseUrl}/api/mcp/discovery`);
  if (!discovery.ok) {
    throw new Error(`Pact MCP discovery failed: HTTP ${discovery.status}`);
  }
  return {
    ...discovery.payload,
    signedHandshake: {
      ok: true,
      identityKeyId: resolvedOptions.__pactDiscovery?.handshake?.payload?.identity?.keyId || ""
    }
  };
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function formatLocalPathForDisplay(value) {
  const text = String(value || "");
  if (!text) {
    return "";
  }
  const normalized = path.normalize(text);
  const home = path.normalize(os.homedir());
  if (home && normalized === home) {
    return "~";
  }
  if (home && normalized.startsWith(`${home}${path.sep}`)) {
    const relativePath = path.relative(home, normalized)
      .split(path.sep)
      .filter(Boolean)
      .join("/");
    return relativePath ? `~/${relativePath}` : "~";
  }
  if (path.isAbsolute(normalized)) {
    return `<local-path>/${path.basename(normalized) || "path"}`;
  }
  return text;
}

function formatTargetInstallLine(target, item = {}) {
  const failed = item.status === "failed" || item.ok === false || Boolean(item.error);
  const status = failed ? "FAIL" : "OK";
  const lines = [`  [${status}] ${targetLabel(target)} (${target})`];
  if (failed) {
    lines.push(`      Reason: ${item.error || "Install failed."}`);
    return lines;
  }
  if (item.tokenSource || item.tokenPrefix) {
    lines.push(`      Auth: ${item.tokenSource || "provided"}${item.tokenPrefix ? ` (${item.tokenPrefix})` : ""}`);
  }
  if (item.httpVerification) {
    lines.push(
      `      MCP verify: tools=${item.httpVerification.toolCount}, stableTool=${item.httpVerification.stableToolName || ""}, health=${yesNo(item.httpVerification.systemHealthOk)}`
    );
  }
  return lines;
}

function resultHasInstallRepair(result) {
  const commands = [
    result?.nextCommand,
    ...(Array.isArray(result?.repairCommands) ? result.repairCommands : [])
  ].filter(Boolean);
  return commands.some((command) => /\bpact-mcp\s+install\b/.test(String(command)));
}

function appendInstallShortcutLines(lines, result) {
  const shortcuts = [];
  const pushShortcut = (label, command) => {
    if (!command || shortcuts.some(([, existing]) => existing === command)) {
      return;
    }
    shortcuts.push([label, command]);
  };
  pushShortcut("One-command priority install", result?.oneCommandPriorityInstall || result?.githubOneLinePriorityInstallCommand);
  pushShortcut("One-command auto install", result?.oneCommandAutoInstall || result?.githubOneLineAutoInstallCommand);
  pushShortcut("Priority install", result?.priorityInstallCommand);
  pushShortcut("Auto install", result?.autoInstallCommand);
  if (shortcuts.length === 0 || (result?.ok !== false && !resultHasInstallRepair(result))) {
    return;
  }
  lines.push("", "Install shortcuts:");
  for (const [label, command] of shortcuts) {
    lines.push(`  ${label}: ${command}`);
  }
}

function appendRepairCommandLines(lines, result) {
  if (!Array.isArray(result?.repairCommands) || result.repairCommands.length === 0) {
    return;
  }
  lines.push("", "Repair commands:");
  for (const command of result.repairCommands) {
    lines.push(`  ${command}`);
  }
}

function formatInstallResult(result) {
  if (result.skipped) {
    return [
      "Pact MCP install skipped.",
      "",
      result.reason || "No client configuration was changed.",
      "Run later: pact-mcp server-config --set --url <pact-url>"
    ].join("\n");
  }
  if (result.cancelled) {
    return [
      "Pact MCP install cancelled.",
      "",
      result.reason || "No client configuration was changed."
    ].join("\n");
  }
  const lines = [
    result.ok ? "Pact MCP install completed." : "Pact MCP install completed with errors.",
    ""
  ];
  if (result.error) {
    lines.push(`Reason: ${result.error}`, "");
  }
  if (result.nextCommand) {
    lines.push(`Next command: ${result.nextCommand}`);
  }
  if (!result.ok) {
    appendInstallShortcutLines(lines, result);
    appendRepairCommandLines(lines, result);
  }
  if (lines.at(-1) !== "") {
    lines.push("");
  }
  lines.push(
    "Server:",
    `  MCP URL: ${result.baseUrl ? `${result.baseUrl}/mcp` : "unknown"}`
  );
  if (result.discoveryManifest) {
    lines.push(`  Local registry: ${formatLocalPathForDisplay(result.discoveryManifest)}`);
  }
  lines.push("", "Clients:");
  const installed = result.installed || {};
  const targets = result.targets?.length ? result.targets : Object.keys(installed);
  for (const target of targets) {
    lines.push(...formatTargetInstallLine(target, installed[target] || {}));
  }
  lines.push("", "Next:");
  lines.push("  Run: pact-mcp doctor");
  lines.push("  Restart any selected agent app that was already running.");
  if (result.targets?.includes("opencode")) {
    lines.push("");
    lines.push("  OpenCode quick test:");
    lines.push(`    curl -s ${result.baseUrl}/mcp -H 'Content-Type: application/json' \\`);
    lines.push("      -H 'X-Pact-Api-Key: <token>' \\");
    lines.push(`      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`);
  }
  if (!result.ok) {
    lines.push("  Re-run failed clients after fixing the reason above.");
  }
  return lines.join("\n");
}

function formatErrorResult(result) {
  const lines = [
    `Pact MCP ${result.command || "command"} failed.`,
    "",
    `Reason: ${result.error || "Command failed."}`
  ];
  if (result.nextCommand) {
    lines.push("", "Next:", `  ${result.nextCommand}`);
  }
  appendInstallShortcutLines(lines, result);
  appendRepairCommandLines(lines, result);
  return lines.join("\n");
}

function formatRegisterResult(result) {
  return [
    "Pact MCP hub registered.",
    "",
    `MCP URL: ${result.mcpUrl || (result.baseUrl ? `${result.baseUrl}/mcp` : "unknown")}`,
    `Verified handshake: ${result.verifiedHandshake || "yes"}`,
    `Local registry: ${formatLocalPathForDisplay(result.discoveryManifest)}`,
    "",
    "Next:",
    "  pact-mcp install"
  ].join("\n");
}

function formatUninstallResult(result) {
  const lines = [
    result.ok ? "Pact MCP uninstall completed." : "Pact MCP uninstall completed with errors.",
    ""
  ];
  if (result.error) {
    lines.push(`Reason: ${result.error}`, "");
  }
  for (const target of result.targets || []) {
    const item = result.uninstalled?.[target] || {};
    const failed = item.status === "failed" || item.ok === false || Boolean(item.error);
    if (failed) {
      lines.push(`  [FAIL] ${targetLabel(target)} (${target})`);
      lines.push(`      Reason: ${item.error || "Uninstall failed."}`);
      continue;
    }
    lines.push(`  [${item.removedMcp === false ? "WARN" : "OK"}] ${targetLabel(target)} (${target})`);
  }
  if (result.discoveryManifest) {
    lines.push("", `Local registry: ${formatLocalPathForDisplay(result.discoveryManifest)}`);
  }
  return lines.join("\n");
}

function formatDoctorResult(result) {
  const checks = result.checks || {};
  const lines = [
    result.ok ? "Pact MCP doctor passed." : "Pact MCP doctor found issues.",
    "",
    `  [${checks.signedDiscovery?.ok ? "OK" : "FAIL"}] Signed discovery${checks.signedDiscovery?.baseUrl ? `: ${checks.signedDiscovery.baseUrl}` : ""}`,
    `  [${checks.discovery?.ok ? "OK" : "FAIL"}] Discovery${checks.discovery?.httpUrl ? `: ${checks.discovery.httpUrl}` : ""}`,
    `  [${checks.initialize?.ok ? "OK" : "FAIL"}] MCP initialize${checks.initialize?.serverVersion ? `: ${checks.initialize.serverVersion}` : ""}`
  ];
  if (checks.toolsList?.skipped) {
    lines.push("  [SKIP] Authenticated tools/list: token not provided");
  } else {
    lines.push(`  [${checks.toolsList?.ok ? "OK" : "FAIL"}] Authenticated tools/list`);
  }
  if (checks.systemHealth?.skipped) {
    lines.push("  [SKIP] Authenticated system.health: token not provided");
  } else {
    lines.push(`  [${checks.systemHealth?.ok ? "OK" : "FAIL"}] Authenticated system.health`);
  }
  lines.push(`  [${checks.deviceManifest?.ok ? "OK" : "WARN"}] Local registry${checks.deviceManifest?.path ? `: ${formatLocalPathForDisplay(checks.deviceManifest.path)}` : ""}`);
  if (result.nextCommand) {
    lines.push("", "Next:", `  ${result.nextCommand}`);
  }
  appendInstallShortcutLines(lines, result);
  appendRepairCommandLines(lines, result);
  return lines.join("\n");
}

function formatServerConfigResult(result) {
  if (result.reset) {
    return [
      "Pact MCP server config reset.",
      "",
      `Local registry: ${formatLocalPathForDisplay(result.path)}`,
      "Next install will scan for a signed Pact server again."
    ].join("\n");
  }
  if (result.profiles) {
    const names = Object.keys(result.profiles);
    return [
      "Pact MCP server config.",
      "",
      `Active profile: ${result.activeName || "(none)"}`,
      `Profiles: ${names.length ? names.join(", ") : "(none)"}`,
      `Local registry: ${formatLocalPathForDisplay(result.path)}`
    ].join("\n");
  }
  return [
    "Pact MCP server config updated.",
    "",
    `Active profile: ${result.activeName || result.profile?.name || "default"}`,
    `MCP URL: ${result.profile?.mcpUrl || (result.profile?.baseUrl ? `${result.profile.baseUrl}/mcp` : "")}`,
    `Local registry: ${formatLocalPathForDisplay(result.path)}`
  ].join("\n");
}

function formatHumanResult(command, result) {
  if (result?.ok === false && result?.commandFailed) {
    return formatErrorResult(result);
  }
  if (command === "install") {
    return formatInstallResult(result);
  }
  if (command === "register") {
    return formatRegisterResult(result);
  }
  if (command === "uninstall") {
    return formatUninstallResult(result);
  }
  if (command === "doctor") {
    return formatDoctorResult(result);
  }
  if (command === "server-config") {
    return formatServerConfigResult(result);
  }
  return JSON.stringify(result, null, 2);
}

function emitResult(result, options, command = "") {
  if (options.json) {
    console.log(JSON.stringify(result, null, options.pretty ? 2 : 0));
  } else {
    console.log(formatHumanResult(command, result));
  }
  if (result?.ok === false) {
    process.exitCode = 1;
  }
}

function emitCommandError(error, options = {}, command = "") {
  const message = redactSensitiveText(error?.message || String(error), sensitiveOptionValues(options));
  const guidance = commandFailureGuidance({ command, message, options });
  emitResult({
    ok: false,
    commandFailed: true,
    command,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    error: message,
    ...guidance
  }, options, command);
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (options.version || command === "version" || command === "--version") {
    emitResult({
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      stableToolName: MCP_STABLE_TOOL_NAME,
      interfaceVersion: MCP_INTERFACE_VERSION
    }, options, "version");
    return;
  }
  if (options.help || command === "help" || !command) {
    console.log(usage());
    return;
  }
  if (command === "install") {
    emitResult(await installCommand(options), options, command);
    return;
  }
  if (command === "register") {
    emitResult(await registerCommand(options), options, command);
    return;
  }
  if (command === "scan") {
    const discovered = await discoverPactHub(options);
    const scanOptions = discovered.ok
      ? { ...options, "resolved-url": discovered.baseUrl, __pactDiscovery: discovered }
      : options;
    const scan = await scanInstallTargets(scanOptions);
    emitResult({
      ...scan,
      serverDiscovery: discovered.ok
        ? {
            ok: true,
            baseUrl: discovered.baseUrl,
            identityKeyId: discovered.handshake?.payload?.identity?.keyId || ""
          }
        : {
            ok: false,
            attempts: discovered.attempts,
            reason: discovered.reason
          }
    }, options, command);
    return;
  }
  if (command === "discover-local") {
    const result = await discoverLocalCommand(options);
    emitResult(result, options, command);
    return;
  }
  if (command === "uninstall") {
    emitResult(await uninstallCommand(options), options, command);
    return;
  }
  if (command === "doctor") {
    emitResult(await doctorCommand(options), options, command);
    return;
  }
  if (command === "discover") {
    emitResult(await discoverCommand(options), options, command);
    return;
  }
  if (command === "server-config") {
    emitResult(await serverConfigCommand(options), options, command);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  const { command, options } = parseArgs(process.argv.slice(2));
  emitCommandError(error, options, command);
});
