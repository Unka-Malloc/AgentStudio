#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const futureModules = [
  "client-gui",
  "client-cli",
  "portable-data",
  "target-adapters",
  "mcp-plugins",
  "skill-hub",
  "model-forwarding",
  "mobile-relay",
  "activity-snapshots",
  "settings"
];
const firstTargets = [
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
const forbiddenCliScopes = [
  'scope == "daemon"',
  'scope == "server"',
  'scope == "mail"',
  'scope == "upload"',
  'scope == "connectors"',
  'scope == "knowledge"',
  'scope == "events"',
  'scope == "context"',
  'scope == "rpc"',
  'scope == "task"',
  'Backend::from_portable_data_dir',
  'execute_method(',
  'backend_core',
  'local-agents',
  'agent invoke'
];
const forbiddenShellLabels = [
  "Console",
  "Server",
  "Modules",
  "Data Connectors",
  "Knowledge Graph",
  "Export",
  "Logs"
];
const removedGuiSourcePaths = [
  "client-gui/lib/src/controllers/app_controller.dart",
  "client-gui/lib/src/models/app_models.dart",
  "client-gui/lib/src/models/knowledge_graph_models.dart",
  "client-gui/lib/src/models/transfer_models.dart",
  "client-gui/lib/src/services/daemon_services.dart",
  "client-gui/lib/src/services/knowledge_graph_service.dart",
  "client-gui/lib/src/services/macos_mail_importer.dart",
  "client-gui/lib/src/services/runtime_services.dart"
];
const removedGuiTestPaths = [
  "client-gui/test/app_controller_backend_test.dart",
  "client-gui/test/checkpoint_store_test.dart",
  "client-gui/test/daemon_services_test.dart",
  "client-gui/test/knowledge_graph_service_test.dart",
  "client-gui/test/macos_mail_importer_test.dart",
  "client-gui/test/runtime_services_test.dart",
  "client-gui/test/transfer_models_test.dart"
];
const removedClientVersionPaths = [
  "client-cli/legacy",
  "client-gui/legacy",
  "client-cli/src/local_agents.rs",
  "client-cli/src/agent_client.rs",
  "client-cli/src/backend_core.rs",
  "client-cli/src/connectors.rs",
  "client-cli/src/upload_queue.rs",
  "client-cli/src/bin/pact-clientd.rs",
  ...removedGuiSourcePaths,
  ...removedGuiTestPaths
];
const forbiddenDefaultGuiTokens = [
  "app_controller.dart",
  "app_models.dart",
  "knowledge_graph_models.dart",
  "transfer_models.dart",
  "daemon_services.dart",
  "knowledge_graph_service.dart",
  "macos_mail_importer.dart",
  "runtime_services.dart",
  "AppController",
  "ClientBackendApi",
  "ModuleDaemon",
  "KnowledgeDaemon",
  "MacOSMail",
  "KnowledgeGraph",
  "UploadSessionInfo"
];
const defaultGuiSurfacePaths = [
  "client-gui/lib/app.dart",
  "client-gui/lib/src/controllers/future_client_controller.dart",
  "client-gui/lib/src/controllers/agent_conversation_actions.dart",
  "client-gui/lib/src/controllers/mcp_plugin_actions.dart",
  "client-gui/lib/src/controllers/mobile_relay_actions.dart",
  "client-gui/lib/src/controllers/model_forwarding_actions.dart",
  "client-gui/lib/src/controllers/skill_hub_actions.dart",
  "client-gui/lib/src/controllers/target_actions.dart",
  "client-gui/lib/src/models/future_client_models.dart",
  "client-gui/lib/src/services/activity_snapshot_service.dart",
  "client-gui/lib/src/services/agent_conversation_service.dart",
  "client-gui/lib/src/services/agent_service.dart",
  "client-gui/lib/src/services/agent_service_actions.dart",
  "client-gui/lib/src/services/mobile_relay_service.dart",
  "client-gui/lib/src/services/portable_data_root.dart",
  "client-gui/lib/src/ui/agents_empty_state.dart",
  "client-gui/lib/src/ui/agents_toolbar.dart",
  "client-gui/lib/src/ui/activity_panel.dart",
  "client-gui/lib/src/ui/agents_canvas.dart",
  "client-gui/lib/src/ui/client_shell.dart",
  "client-gui/lib/src/ui/manual_target_dialog.dart",
  "client-gui/lib/src/ui/mcp_plugins_panel.dart",
  "client-gui/lib/src/ui/model_forwarding_panel.dart",
  "client-gui/lib/src/ui/panel_frame.dart",
  "client-gui/lib/src/ui/settings_panel.dart",
  "client-gui/lib/src/ui/shell_navigation.dart",
  "client-gui/lib/src/ui/skill_hub_panel.dart",
  "client-gui/lib/src/ui/target_card.dart"
];
const defaultGuiMaxLines = 260;
const rustCliRoot = "client-cli";

const failures = [];

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

async function exists(relativePath) {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function readText(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

function sameSet(actual, expected) {
  return actual.length === expected.length && expected.every((item) => actual.includes(item));
}

function runJson(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
    return null;
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`${command} ${args.join(" ")} did not return JSON: ${error.message}`);
    return null;
  }
}

function collectEnumValues(source, enumName) {
  const match = source.match(new RegExp(`enum\\s+${enumName}\\s*\\{([\\s\\S]*?)\\}`));
  if (!match) {
    return [];
  }
  return match[1]
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.split(/\s|\(/)[0]);
}

async function collectRustUnsafeFiles(relativeRoot) {
  const absoluteRoot = path.join(repoRoot, relativeRoot);
  const unsafeFiles = [];

  async function walk(relativeDir = "") {
    const items = await fs.readdir(path.join(absoluteRoot, relativeDir), { withFileTypes: true });
    for (const item of items) {
      if (item.name === "target") {
        continue;
      }
      const child = relativeDir ? `${relativeDir}/${item.name}` : item.name;
      if (item.isDirectory()) {
        await walk(child);
      } else if (item.isFile() && child.endsWith(".rs")) {
        const content = await fs.readFile(path.join(absoluteRoot, child), "utf8");
        if (/(^|[^A-Za-z0-9_])unsafe([^A-Za-z0-9_]|$)/.test(content)) {
          unsafeFiles.push(`${relativeRoot}/${child}`);
        }
      }
    }
  }

  await walk();
  return unsafeFiles.sort();
}

const packaging = await readJson("client-gui/packaging.modules.json");
assert(packaging.packageProfile === "future-client", "default package profile must be future-client");
const modules = packaging.modules || {};
const enabledConfigModules = Object.entries(modules)
  .filter(([, module]) => module.enabled !== false)
  .map(([id]) => id)
  .sort();
assert(sameSet(enabledConfigModules, [...futureModules].sort()), `enabled config modules must be exactly ${futureModules.join(", ")}`);
for (const moduleId of futureModules) {
  assert(modules[moduleId]?.required === true, `future module must be required: ${moduleId}`);
}
assert(
  !JSON.stringify(packaging).toLowerCase().includes("legacy"),
  "packaging config must not contain legacy module definitions"
);
const deferredCapabilities = packaging.deferredCapabilities || {};
assert(
  sameSet(Object.keys(deferredCapabilities).sort(), [
    "client-connectors",
    "clientd",
    "knowledge-cache",
    "mail-import-runtime",
    "mcp-local-bridge",
    "upload-queue"
  ]),
  "deferred client capabilities must be explicit TODO placeholders, not hidden package modules"
);
for (const [capabilityId, capability] of Object.entries(deferredCapabilities)) {
  assert(capability.status === "todo", `deferred client capability must be status=todo: ${capabilityId}`);
  assert(!modules[capabilityId], `deferred client capability must not be packaged as an active module: ${capabilityId}`);
}
const packagedTargets = modules["target-adapters"]?.targetAdapters || [];
assert(sameSet([...packagedTargets].sort(), [...firstTargets].sort()), "target-adapters module must list every first-batch target");
const portableDirs = modules["portable-data"]?.portableDirectories || [];
for (const legacyDir of ["backend", "logs", "exports", "mail-imports", "knowledge", "chat-index"]) {
  assert(!portableDirs.includes(legacyDir), `portable data must not include legacy directory: ${legacyDir}`);
}
assert(!portableDirs.some((item) => String(item).startsWith("connectors/")), "portable data must not include connector directories");

const packagePlan = runJson(process.execPath, ["client-gui/scripts/package-client.mjs", "--dry-run"]);
if (packagePlan) {
  const enabledPlanModules = packagePlan.enabledModules.map((item) => item.id).sort();
  assert(sameSet(enabledPlanModules, [...futureModules].sort()), "package dry-run must enable only future modules");
  assert(!JSON.stringify(packagePlan).toLowerCase().includes("legacy"), "package dry-run must not emit legacy metadata");
}

for (const relativePath of removedClientVersionPaths) {
  assert(!(await exists(relativePath)), `${relativePath} must not exist in the single-version client`);
}

const cargoToml = await readText("client-cli/Cargo.toml");
assert(!cargoToml.includes('name = "pact-clientd"'), "Cargo package must not build pact-clientd by default");
const libRs = await readText("client-cli/src/lib.rs");
for (const moduleName of ["backend_core", "connectors", "upload_queue", "local_agents", "agent_client"]) {
  assert(!libRs.includes(`pub mod ${moduleName}`), `client library must not export legacy module ${moduleName}`);
}
const cliSource = await readText("client-cli/src/bin/pact-client.rs");
for (const token of forbiddenCliScopes) {
  assert(!cliSource.includes(token), `pact-client main CLI must not contain legacy token: ${token}`);
}
for (const token of ["targets scan", "mcp config plan", "mcp plugin status", "forward --profile", "agents pair", "conversations list|append|delete", "agent message send", "mobile relay"]) {
  assert(cliSource.includes(token), `pact-client usage must expose future command: ${token}`);
}

const rustCliUnsafeFiles = await collectRustUnsafeFiles(rustCliRoot);
assert(
  rustCliUnsafeFiles.length === 0,
  `Rust CLI source path must not contain unsafe: ${rustCliUnsafeFiles.join(", ")}`
);

const futureClientModels = await readText("client-gui/lib/src/models/future_client_models.dart");
const appSections = collectEnumValues(futureClientModels, "FutureClientSection");
assert(sameSet(appSections, ["agents", "mcpPlugins", "skillHub", "modelForwarding", "mobileRelay", "activity", "settings"]), "FutureClientSection enum must contain only the seven future modules");

const agentServiceActionsSource = await readText("client-gui/lib/src/services/agent_service_actions.dart");
assert(agentServiceActionsSource.includes("'agents'") && agentServiceActionsSource.includes("'pair'"), "agent_service_actions.dart must contain 'agents' and 'pair' tokens for CLI execution");
assert(!agentServiceActionsSource.match(/\[\s*'pair'/), "GUI service layer must not use top-level 'pair' command");
const agentConversationServiceSource = await readText("client-gui/lib/src/services/agent_conversation_service.dart");
assert(agentConversationServiceSource.includes("'conversations'") && agentConversationServiceSource.includes("agentService.runCli"),
  "agent_conversation_service.dart must delegate conversation IO to pact-client CLI"
);
assert(agentConversationServiceSource.includes("sendRuntimeMessage") &&
  agentConversationServiceSource.includes("'agent'") &&
  agentConversationServiceSource.includes("'message'") &&
  agentConversationServiceSource.includes("'send'"),
  "agent_conversation_service.dart must delegate message sends to pact-client agent message send"
);
for (const token of ["appendLocalMessage", "deleteSession", "'append'", "'delete'"]) {
  assert(!agentConversationServiceSource.includes(token), `agent_conversation_service.dart must not expose Pact-local write path: ${token}`);
}
const conversationsRustSource = await readText("client-cli/src/conversations.rs");
assert(
  conversationsRustSource.includes('"native-history"') &&
    conversationsRustSource.includes('"readOnly": true') &&
    conversationsRustSource.includes('"precise-adapter"') &&
    conversationsRustSource.includes("enum HistoryAdapter") &&
    conversationsRustSource.includes("fn adapter_for_agent") &&
    conversationsRustSource.includes("unsupported native history adapter") &&
    conversationsRustSource.includes("ValueRef::Blob") &&
    conversationsRustSource.includes("native agent history is read-only"),
  "client-cli conversations.rs must expose per-agent precise native history adapters, not Pact-local conversation storage"
);
for (const target of ["codex", "antigravity", "claude-code", "cursor", "opencode", "openclaw", "kilo-code", "copilot", "hermes"]) {
  assert(conversationsRustSource.includes(`"${target}"`), `native history scanner must include first-batch target: ${target}`);
}
const agentConversationActionsSource = await readText("client-gui/lib/src/controllers/agent_conversation_actions.dart");
assert(!agentConversationActionsSource.includes("conversationService.appendLocalMessage"),
  "agent_conversation_actions.dart must not append Pact-local messages for native history"
);
assert(agentConversationActionsSource.includes("conversationService.sendRuntimeMessage"),
  "agent_conversation_actions.dart must send through runtime adapters instead of local history"
);
const agentConversationWorkspaceSource = await readText("client-gui/lib/src/ui/agent_conversation_workspace.dart");
assert(agentConversationWorkspaceSource.includes("_RuntimeMessageComposer") &&
  agentConversationWorkspaceSource.includes("sendConversationMessage") &&
  agentConversationWorkspaceSource.includes("TextField("),
  "agent_conversation_workspace.dart must expose runtime message composer while keeping history read-only"
);
const mobileRelayRustSource = await readText("client-cli/src/mobile_relay.rs");
const runtimeAdaptersRustSource = await readText("client-cli/src/runtime_adapters.rs");
assert(runtimeAdaptersRustSource.includes("enum RuntimeAdapter") &&
  runtimeAdaptersRustSource.includes('"runtime-adapter"') &&
  runtimeAdaptersRustSource.includes("codex-cli-exec") &&
  runtimeAdaptersRustSource.includes("opencode-cli-run") &&
  runtimeAdaptersRustSource.includes("configured-command") &&
  runtimeAdaptersRustSource.includes("approvalOwner"),
  "runtime_adapters.rs must expose per-agent runtime protocol adapters and explicit approval ownership"
);
const advertisedRelayCommandBlocks = [...mobileRelayRustSource.matchAll(/"commands":\s*\[[\s\S]*?\]/g)].map((match) => match[0]);
assert(advertisedRelayCommandBlocks.length >= 1, "mobile_relay.rs must advertise relay command capabilities");
for (const block of advertisedRelayCommandBlocks) {
  assert(block.includes('"agent.sessions.list"'), "mobile relay capability block must advertise native session list");
  assert(block.includes('"agent.message.send"'), "mobile relay capability block must advertise runtime message send");
}
assert(mobileRelayRustSource.includes("runtime_adapters::send_message") &&
  mobileRelayRustSource.includes("fn relay_capabilities") &&
  mobileRelayRustSource.includes("relayed_agent_sessions_list_executes_native_history_adapter") &&
  mobileRelayRustSource.includes("relayed_agent_message_send_executes_runtime_adapter"),
  "mobile_relay.rs must keep phone pairing capabilities, relayed native history, and relayed runtime message send covered by tests"
);
const mobileRelayServiceSource = await readText("client-gui/lib/src/services/mobile_relay_service.dart");
assert(mobileRelayServiceSource.includes("'mobile'") && mobileRelayServiceSource.includes("'relay'") && mobileRelayServiceSource.includes("agentService.runCli"),
  "mobile_relay_service.dart must delegate relay network/config operations to pact-client CLI"
);
const activitySnapshotServiceSource = await readText("client-gui/lib/src/services/activity_snapshot_service.dart");
assert(activitySnapshotServiceSource.includes("'activity'") && activitySnapshotServiceSource.includes("'snapshots'") && activitySnapshotServiceSource.includes("agentService.runCli"),
  "activity_snapshot_service.dart must delegate activity/snapshot data reads to pact-client CLI"
);
for (const [relativePath, source] of [
  ["client-gui/lib/src/services/agent_conversation_service.dart", agentConversationServiceSource],
  ["client-gui/lib/src/services/mobile_relay_service.dart", mobileRelayServiceSource],
  ["client-gui/lib/src/services/activity_snapshot_service.dart", activitySnapshotServiceSource]
]) {
  for (const token of ["HttpClient", "/api/mobile-relay", "readAsString", "writeAsString", "Directory(", "File("]) {
    assert(!source.includes(token), `${relativePath} must not perform runtime IO/network directly; use pact-client CLI`);
  }
}

for (const relativePath of defaultGuiSurfacePaths) {
  const source = await readText(relativePath);
  const lineCount = source.split(/\r?\n/).length;
  assert(lineCount <= defaultGuiMaxLines, `${relativePath} must stay below ${defaultGuiMaxLines} lines; split cohesive modules instead of growing a super-file`);
  for (const token of forbiddenDefaultGuiTokens) {
    assert(!source.includes(token), `${relativePath} must not reference legacy GUI token: ${token}`);
  }
}
const shellSource = (await Promise.all(
  defaultGuiSurfacePaths.map((relativePath) => readText(relativePath))
)).join("\n");
for (const label of forbiddenShellLabels) {
  assert(!shellSource.includes(label), `future client shell must not expose old navigation label: ${label}`);
}
for (const label of ["Agents", "MCP Plugins", "Skill Hub", "Model Forwarding", "Mobile Relay", "Activity And Snapshots", "Settings"]) {
  assert(shellSource.includes(label), `future client shell must expose module label: ${label}`);
}

// New P0 checks

// 3. mcp_trust.rs must not contain handshakeVerified or metadata.signature direct trust
const mcpTrustSource = await readText("client-cli/src/mcp_trust.rs");
assert(!mcpTrustSource.includes("handshakeVerified") && !mcpTrustSource.includes("DevUnverifiedOverride"),
  "mcp_trust.rs must not contain handshakeVerified boolean trust or DevUnverifiedOverride in production code"
);
assert(mcpTrustSource.includes("verify_endpoint_trust_with_env") || mcpTrustSource.includes("TrustReceipt"),
  "mcp_trust.rs must implement receipt-based verification"
);

// 5. targets.rs must have unified adapter_capabilities function, not multiple hardcoded lists
const targetsSource = await readText("client-cli/src/targets.rs");
const supportsApplyMatches = targetsSource.match(/matches!\([\s\S]*?"openclaw".*?"kilo-code"\)/);
assert(supportsApplyMatches === null,
  "targets.rs must not contain duplicate supports_apply list; use adapter_capabilities_for or adapter_supports_action"
);
assert(targetsSource.includes("adapter_supports_action") || targetsSource.includes("adapter_capabilities_for"),
  "targets.rs must contain unified adapter capability function"
);
assert(targetsSource.includes('"runtime.message.send"') && targetsSource.includes("target_supports_default_runtime"),
  "targets.rs must advertise runtime.message.send only through the target runtime capability gate"
);

// 6. mcp_plugins.rs must not unconditionally return status updated
const mcpPluginsSource = await readText("client-cli/src/mcp_plugins.rs");
const alwaysUpdatedStatus = mcpPluginsSource.match(/"updated"/);
assert(mcpPluginsSource.includes("apply_ok") || !mcpPluginsSource.includes('"updated"'),
  "mcp_plugins.rs must conditionally set status based on apply result"
);

// 7. mcp_plugins_panel.dart must reference supportedActions or supportsAction
const mcpPluginsPanelSource = await readText("client-gui/lib/src/ui/mcp_plugins_panel.dart");
assert(mcpPluginsPanelSource.includes("supportedAction") || mcpPluginsPanelSource.includes("canUpdateMcpPlugin") ||
  mcpPluginsPanelSource.includes("canRollbackMcpPlugin"),
  "mcp_plugins_panel.dart must reference target capability methods"
);

// 8. mcp_plugin_actions.dart must not show success on result['ok'] false
const mcpPluginActionsSource = await readText("client-gui/lib/src/controllers/mcp_plugin_actions.dart");
assert(!mcpPluginActionsSource.includes('无条件') && mcpPluginActionsSource.includes("result['ok']"),
  "mcp_plugin_actions.dart must check result['ok'] before showing success"
);

// 9. set_json_path must not directly overwrite non-object
const setJsonPathMatch = targetsSource.match(/\*entry\s*=\s*Value::Object/);
assert(setJsonPathMatch === null,
  "set_json_path must not silently overwrite non-object paths with Value::Object"
);

// 10. list_model_profiles output must use masking
const forwardingSource = await readText("client-cli/src/forwarding.rs");
assert(forwardingSource.includes("mask_profile_secrets") || forwardingSource.includes('"***"'),
  "forwarding.rs list_model_profiles must mask secret values"
);

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  futureModules,
  firstTargets,
  removedClientVersionPathsChecked: removedClientVersionPaths.length,
  packagePlanChecked: Boolean(packagePlan)
}, null, 2));
