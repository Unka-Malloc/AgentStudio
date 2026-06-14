#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DOWNSTREAM_CLIENT_ASPECT_PROTOCOL_VERSION,
  DOWNSTREAM_CLIENT_ASPECT_ROUTE_TARGETS,
  AcpAgentFrameworkAdapterLayer,
  McpAgentFrameworkAdapterLayer,
  assembleDownstreamClientAspect,
  createDownstreamClientAspectService,
  defaultDownstreamClientFrameworks,
  downstreamClientFrameworksFromAcpRegistries,
  resolveCommandCandidate
} from "../platform/common/downstream-client-aspect/index.mjs";
import { createAgentCliExecConnection } from "../platform/specialized/capabilities/agent-relay/acp-agent-relay/agent-cli-exec-connection.mjs";

const CANONICAL_FRAMEWORKS = Object.freeze([
  "openclaw",
  "claude-code",
  "codex",
  "antigravity",
  "opencode",
  "copilot",
  "kilo-code",
  "cursor",
  "hermes"
]);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-downstream-client-aspect-"));
const fixtureBin = path.join(tempRoot, "bin");
await fs.mkdir(fixtureBin, { recursive: true });
const codexAcpPath = path.join(fixtureBin, process.platform === "win32" ? "codex-acp.cmd" : "codex-acp");
const codexCliPath = path.join(fixtureBin, process.platform === "win32" ? "codex.cmd" : "codex");
const openCodePath = path.join(fixtureBin, process.platform === "win32" ? "opencode.cmd" : "opencode");
const openClawPath = path.join(fixtureBin, process.platform === "win32" ? "openclaw.cmd" : "openclaw");
const claudePath = path.join(fixtureBin, process.platform === "win32" ? "claude.cmd" : "claude");
const claudeCodeAcpPath = path.join(fixtureBin, process.platform === "win32" ? "claude-code-acp.cmd" : "claude-code-acp");
const copilotPath = path.join(fixtureBin, process.platform === "win32" ? "copilot.cmd" : "copilot");
const kiloPath = path.join(fixtureBin, process.platform === "win32" ? "kilo.cmd" : "kilo");
const cursorPath = path.join(fixtureBin, process.platform === "win32" ? "cursor.cmd" : "cursor");
const hermesPath = path.join(fixtureBin, process.platform === "win32" ? "hermes.cmd" : "hermes");
const registryAgentPath = path.join(fixtureBin, process.platform === "win32" ? "registry-acp.cmd" : "registry-acp");

async function writeExecutable(filePath) {
  await fs.writeFile(
    filePath,
    process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n",
    "utf8"
  );
  if (process.platform !== "win32") {
    await fs.chmod(filePath, 0o755);
  }
}

for (const filePath of [
  codexAcpPath,
  codexCliPath,
  openCodePath,
  openClawPath,
  claudePath,
  claudeCodeAcpPath,
  copilotPath,
  kiloPath,
  cursorPath,
  hermesPath,
  registryAgentPath
]) {
  await writeExecutable(filePath);
}

const envWithAgentBins = {
  ...process.env,
  PATH: fixtureBin
};

const frameworkIds = defaultDownstreamClientFrameworks().map((framework) => framework.frameworkId);
assert.deepEqual(frameworkIds, CANONICAL_FRAMEWORKS, "downstream client aspect framework catalog must match canonical agent targets.");

const commandProbe = resolveCommandCandidate(["codex-acp"], { env: envWithAgentBins, includeDefaultLocalBin: false });
assert.equal(commandProbe.found, true, "fixture codex-acp command must be discoverable.");
assert.equal(commandProbe.path, codexAcpPath);

const registeredTargets = [];
const registeredVirtualAgents = [];
const { service, summary, capabilities } = assembleDownstreamClientAspect({
  env: envWithAgentBins,
  includeDefaultLocalBin: false,
  targetRegistry: {
    upsertTarget(target) {
      registeredTargets.push(target);
      return target;
    }
  },
  virtualAgentRegistry: {
    upsertAgent(agent) {
      registeredVirtualAgents.push(agent);
      return agent;
    }
  },
  start: {
    now: new Date("2026-06-05T00:00:00.000Z")
  }
});

assert.equal(summary.ok, true);
assert.equal(summary.protocolVersion, DOWNSTREAM_CLIENT_ASPECT_PROTOCOL_VERSION);
assert.equal(summary.frameworkCount, CANONICAL_FRAMEWORKS.length);
assert.equal(summary.layerCount, 2);
assert.equal(summary.assemblyCount, CANONICAL_FRAMEWORKS.length * 2);
assert.equal(summary.byProtocol.mcp, CANONICAL_FRAMEWORKS.length);
assert.equal(summary.byProtocol.acp, CANONICAL_FRAMEWORKS.length);
assert.deepEqual(summary.routeTargets, DOWNSTREAM_CLIENT_ASPECT_ROUTE_TARGETS);
assert.equal(service.listProtocolLayers()[0].adapterKind, "agent-framework-mcp-adapter-layer");
assert.equal(service.listProtocolLayers()[1].adapterKind, "agent-framework-acp-adapter-layer");
assert.ok(service.listProtocolLayers()[0].layerId !== service.listProtocolLayers()[1].layerId, "MCP and ACP layers must be independent.");

for (const frameworkId of CANONICAL_FRAMEWORKS) {
  const record = capabilities.find((item) => item.frameworkId === frameworkId && item.protocol === "acp");
  assert.ok(record, `${frameworkId} must have an ACP/Relay participant record.`);
  assert.ok(record.acpRelay?.target?.targetId, `${frameworkId} must expose a relay target descriptor.`);
  assert.ok(record.acpRelay?.virtualAgent?.virtualAgentId, `${frameworkId} must expose a relay virtual agent descriptor.`);
}

function assertNativeAcpTarget(record, { executablePath, args = [], launchCommand = "" } = {}) {
  assert.equal(record.status, "assembled");
  assert.equal(record.communication.transport, "stdio");
  assert.equal(record.acpRelay.target.transport.protocolStyle, "agent-client-protocol-v1");
  assert.equal(record.acpRelay.target.transport.command.executable, executablePath);
  assert.deepEqual(record.acpRelay.target.transport.command.args, args);
  assert.equal(record.acpRelay.target.metadata.public.relayParticipant, true);
  assert.equal(record.acpRelay.target.metadata.public.nativeAcpTargetSupported, true);
  if (launchCommand) {
    assert.equal(record.acpRelay.target.metadata.public.launchCommand, launchCommand);
  }
}

const codexMcp = capabilities.find((record) => record.frameworkId === "codex" && record.protocol === "mcp");
assert.equal(codexMcp.status, "assembled");
assert.equal(codexMcp.adapterId, "codex-mcp-cli");
assert.equal(codexMcp.profileId, "pact.mcp.codex");
assert.equal(codexMcp.capabilities.mcpInterfaceVersion, "v0.0.1:mcp:interface-1");

const codexAcp = capabilities.find((record) => record.frameworkId === "codex" && record.protocol === "acp");
assert.equal(codexAcp.status, "assembled");
assert.equal(codexAcp.adapterId, "codex-acp-stdio");
assert.equal(codexAcp.profileId, "pact.acp.codex");
assert.equal(codexAcp.capabilities.installPackage, "@zed-industries/codex-acp");
assert.equal(codexAcp.communication.transport, "stdio");
assert.equal(codexAcp.acpRelay.target.transport.protocolStyle, "agent-client-protocol-v1");
assert.equal(codexAcp.acpRelay.target.transport.command.executable, codexAcpPath);
assert.equal(codexAcp.acpRelay.virtualAgent.reasoningVisibilityPolicy, "never");
assert.ok(codexMcp.startup.sequence < codexAcp.startup.sequence, "framework adapters must be assembled layer-by-layer at startup.");

const antigravityAcp = capabilities.find((record) => record.frameworkId === "antigravity" && record.protocol === "acp");
assert.equal(antigravityAcp.status, "assembled");
assert.equal(antigravityAcp.adapterId, "antigravity-agentapi");
assert.equal(antigravityAcp.communication.transport, "antigravity-agentapi");
assert.equal(antigravityAcp.capabilities.connectObservationSupported, true);
assert.equal(antigravityAcp.acpRelay.target.transport.type, "antigravity-agentapi");

const openCodeAcp = capabilities.find((record) => record.frameworkId === "opencode" && record.protocol === "acp");
assert.equal(openCodeAcp.status, "assembled");
assert.equal(openCodeAcp.adapterId, "opencode-acp-stdio");
assert.equal(openCodeAcp.profileId, "pact.acp.opencode");
assert.equal(openCodeAcp.communication.transport, "stdio");
assert.equal(openCodeAcp.capabilities.configurationStrategy, "opencode-native-acp-stdio");
assert.equal(openCodeAcp.capabilities.tools.includes("opencode.acp"), true);
assert.equal(openCodeAcp.acpRelay.target.targetId, "opencode.acp:default");
assert.equal(openCodeAcp.acpRelay.target.transport.protocolStyle, "agent-client-protocol-v1");
assert.equal(openCodeAcp.acpRelay.target.transport.command.executable, openCodePath);
assert.deepEqual(openCodeAcp.acpRelay.target.transport.command.args, ["acp"]);
assert.equal(openCodeAcp.acpRelay.target.metadata.public.nativeOpenCodeAcp, true);
assert.equal(openCodeAcp.acpRelay.virtualAgent.virtualAgentId, "opencode.acp-agent");

const openClawAcp = capabilities.find((record) => record.frameworkId === "openclaw" && record.protocol === "acp");
assertNativeAcpTarget(openClawAcp, {
  executablePath: openClawPath,
  args: ["acp"],
  launchCommand: "openclaw acp"
});

const kiloMcp = capabilities.find((record) => record.frameworkId === "kilo-code" && record.protocol === "mcp");
const kiloAcp = capabilities.find((record) => record.frameworkId === "kilo-code" && record.protocol === "acp");
assert.equal(kiloMcp.status, "assembled");
assert.equal(kiloMcp.adapterId, "kilo-code-mcp-config");
assertNativeAcpTarget(kiloAcp, {
  executablePath: kiloPath,
  args: ["acp"],
  launchCommand: "kilo acp"
});

const claudeAcp = capabilities.find((record) => record.frameworkId === "claude-code" && record.protocol === "acp");
assertNativeAcpTarget(claudeAcp, {
  executablePath: claudeCodeAcpPath,
  args: [],
  launchCommand: "claude-code-acp"
});
assert.equal(claudeAcp.adapterId, "claude-code-acp-stdio");
assert.equal(claudeAcp.capabilities.installPackage, "@zed-industries/claude-code-acp");

const copilotAcp = capabilities.find((record) => record.frameworkId === "copilot" && record.protocol === "acp");
assertNativeAcpTarget(copilotAcp, {
  executablePath: copilotPath,
  args: ["--acp"],
  launchCommand: "copilot --acp"
});

const cursorAcp = capabilities.find((record) => record.frameworkId === "cursor" && record.protocol === "acp");
assertNativeAcpTarget(cursorAcp, {
  executablePath: cursorPath,
  args: ["agent", "acp"],
  launchCommand: "cursor agent acp"
});

const hermesAcp = capabilities.find((record) => record.frameworkId === "hermes" && record.protocol === "acp");
assertNativeAcpTarget(hermesAcp, {
  executablePath: hermesPath,
  args: ["acp"],
  launchCommand: "hermes acp"
});

const mcpRoute = service.translateInboundRequest({
  protocol: "mcp",
  frameworkId: "codex",
  method: "tools/call",
  input: { name: "pact.discovery" },
  context: { workspaceId: "workspace-1" }
});
assert.equal(mcpRoute.ok, true);
assert.equal(mcpRoute.routeTarget, "mcp-server-side");
assert.equal(mcpRoute.operationBoundary, "v0.0.1:tool:management-1");
assert.equal(mcpRoute.routeIntent.adapterId, "codex-mcp-cli");

const acpRoute = service.translateInboundRequest({
  protocol: "acp",
  frameworkId: "codex",
  method: "session/prompt",
  input: { sessionId: "relay-session-1" },
  context: { workspaceId: "workspace-1" }
});
assert.equal(acpRoute.ok, true);
assert.equal(acpRoute.routeTarget, "acp-agent-relay");
assert.equal(acpRoute.operationBoundary, "v0.0.1:agent:acp-agent-relay-1");
assert.equal(acpRoute.routeIntent.adapterId, "codex-acp-stdio");

const unsupportedRoute = service.translateInboundRequest({ protocol: "a2a", method: "message/send" });
assert.equal(unsupportedRoute.ok, false);
assert.equal(unsupportedRoute.reasonCode, "downstream_protocol_not_supported");

assert.ok(
  registeredTargets.some((target) => target.targetId === "codex.acp:default"),
  "ACP layer must register Codex ACP target descriptor through the shared target registry."
);
assert.ok(
  registeredVirtualAgents.some((agent) => agent.virtualAgentId === "codex.acp-agent"),
  "ACP layer must register Codex virtual agent descriptor through the shared virtual agent registry."
);
assert.equal(
  registeredTargets.filter((target) => target.metadata?.public?.relayParticipant === true).length,
  CANONICAL_FRAMEWORKS.length,
  "Every first-class target must be registered as a Relay participant."
);

const missingCodexAcpService = createDownstreamClientAspectService({
  env: { ...process.env, PATH: "" },
  includeDefaultLocalBin: false
});
missingCodexAcpService.start({ now: new Date("2026-06-05T00:00:00.000Z") });
const missingCodexAcp = missingCodexAcpService
  .listCapabilities({ protocol: "acp", frameworkId: "codex" })
  .at(0);
assert.equal(missingCodexAcp.status, "installable");
assert.equal(missingCodexAcp.reasonCode, "acp_adapter_package_not_installed");
assert.deepEqual(missingCodexAcp.acpRelay.target.transport.command.args, ["--yes", "@zed-industries/codex-acp"]);
const missingOpenCodeAcp = missingCodexAcpService
  .listCapabilities({ protocol: "acp", frameworkId: "opencode" })
  .at(0);
assert.equal(missingOpenCodeAcp.status, "missing_dependency");
assert.equal(missingOpenCodeAcp.reasonCode, "acp_adapter_command_not_found");
assert.equal(missingOpenCodeAcp.adapterId, "opencode-acp-stdio");
assert.equal(missingOpenCodeAcp.acpRelay.target.enabled, false);
const missingClaudeAcp = missingCodexAcpService
  .listCapabilities({ protocol: "acp", frameworkId: "claude-code" })
  .at(0);
assert.equal(missingClaudeAcp.status, "installable");
assert.equal(missingClaudeAcp.reasonCode, "acp_adapter_package_not_installed");
assert.equal(missingClaudeAcp.acpRelay.target.enabled, false);
assert.deepEqual(missingClaudeAcp.acpRelay.target.transport.command.args, ["--yes", "@zed-industries/claude-code-acp"]);

const codexOnlyBin = path.join(tempRoot, "codex-only-bin");
await fs.mkdir(codexOnlyBin, { recursive: true });
const codexOnlyPath = path.join(codexOnlyBin, process.platform === "win32" ? "codex.cmd" : "codex");
await fs.writeFile(
  codexOnlyPath,
  process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n",
  "utf8"
);
if (process.platform !== "win32") {
  await fs.chmod(codexOnlyPath, 0o755);
}
const degradedCodexService = createDownstreamClientAspectService({
  env: { ...process.env, PATH: codexOnlyBin },
  includeDefaultLocalBin: false
});
degradedCodexService.start({ now: new Date("2026-06-05T00:00:00.000Z") });
const degradedCodexAcp = degradedCodexService
  .listCapabilities({ protocol: "acp", frameworkId: "codex" })
  .at(0);
assert.equal(degradedCodexAcp.status, "degraded");
assert.equal(degradedCodexAcp.reasonCode, "acp_adapter_unavailable_cli_fallback");
assert.equal(degradedCodexAcp.adapterId, "codex-cli-exec-fallback");
assert.equal(degradedCodexAcp.communication.transport, "codex-cli-exec");
assert.equal(degradedCodexAcp.communication.degraded, true);
assert.equal(degradedCodexAcp.capabilities.degraded, true);
assert.equal(degradedCodexAcp.capabilities.degradation.preferredTransport, "stdio");
assert.equal(degradedCodexAcp.capabilities.degradation.fallbackTransport, "codex-cli-exec");
assert.equal(degradedCodexAcp.acpRelay.target.enabled, true);
assert.equal(degradedCodexAcp.acpRelay.target.transport.command.executable, codexOnlyPath);
assert.equal(degradedCodexAcp.acpRelay.target.transport.command.sandbox, "read-only");
assert.equal(degradedCodexAcp.acpRelay.target.metadata.public.degraded, true);
assert.equal(degradedCodexAcp.acpRelay.virtualAgent.virtualAgentId, "codex.cli-fallback-agent");

const registryPlatform = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows"
}[process.platform] || process.platform;
const registryArch = {
  arm64: "aarch64",
  x64: "x86_64"
}[process.arch] || process.arch;
const registryPlatformKey = `${registryPlatform}-${registryArch}`;
const registryFixture = {
  version: "1.0.0",
  agents: [
    {
      id: "registry-demo",
      name: "Registry Demo",
      version: "2.3.4",
      description: "Demo ACP registry agent.",
      distribution: {
        binary: {
          [registryPlatformKey]: {
            archive: "https://example.invalid/registry-demo.tgz",
            cmd: "registry-acp",
            args: ["--stdio"],
            env: {
              REGISTRY_DEMO_TOKEN: "must-not-appear"
            }
          }
        }
      }
    }
  ]
};
const registryFrameworks = downstreamClientFrameworksFromAcpRegistries([registryFixture], {
  platform: process.platform,
  arch: process.arch
});
assert.equal(registryFrameworks.length, 1);
assert.equal(registryFrameworks[0].frameworkId, "registry-demo");
assert.equal(registryFrameworks[0].acp.transport, "stdio");
assert.equal(registryFrameworks[0].acp.metadata.public.registryImported, true);

const registryTargets = [];
const registryService = createDownstreamClientAspectService({
  env: envWithAgentBins,
  includeDefaultLocalBin: false,
  acpRegistries: [registryFixture],
  targetRegistry: {
    upsertTarget(target) {
      registryTargets.push(target);
      return target;
    }
  }
});
registryService.start({ now: new Date("2026-06-05T00:00:00.000Z") });
const registryDemoAcp = registryService
  .listCapabilities({ protocol: "acp", frameworkId: "registry-demo" })
  .at(0);
assert.equal(registryDemoAcp.status, "assembled");
assert.equal(registryDemoAcp.communication.transport, "stdio");
assert.equal(registryDemoAcp.capabilities.configurationStrategy, "acp-registry-distribution");
assert.equal(registryDemoAcp.acpRelay.target.targetId, "registry-demo.acp-registry:default");
assert.equal(registryDemoAcp.acpRelay.target.transport.command.executable, registryAgentPath);
assert.deepEqual(registryDemoAcp.acpRelay.target.transport.command.args, ["--stdio"]);
assert.equal(registryDemoAcp.acpRelay.target.metadata.public.registryImported, true);
assert.equal(registryDemoAcp.acpRelay.target.metadata.public.registryAgentId, "registry-demo");
assert.equal(JSON.stringify(registryDemoAcp).includes("must-not-appear"), false);
assert.equal(
  registryTargets.some((target) => target.transport?.command?.env?.REGISTRY_DEMO_TOKEN === "must-not-appear"),
  true,
  "internal registry-imported ACP target descriptor must retain launch env for target startup."
);

const argvCaptureScriptPath = path.join(tempRoot, "argv-capture.mjs");
const argvCaptureLogPath = path.join(tempRoot, "argv-capture.json");
await fs.writeFile(
  argvCaptureScriptPath,
  [
    "import fs from 'node:fs';",
    "const argv = process.argv.slice(2);",
    "fs.writeFileSync(process.env.PACT_ARGV_CAPTURE_LOG_PATH, JSON.stringify(argv), 'utf8');",
    "process.stdout.write(`captured:${argv.join('|')}\\n`);"
  ].join("\n"),
  "utf8"
);
const agentCliConnection = createAgentCliExecConnection({
  target: {
    targetId: "verify.agent-cli-exec",
    transport: {
      type: "agent-cli-exec",
      command: {
        executable: process.execPath,
        args: [argvCaptureScriptPath, "--prompt", "{prompt}", "--format", "json"],
        timeoutMs: 30000,
        env: {
          PACT_ARGV_CAPTURE_LOG_PATH: argvCaptureLogPath
        }
      }
    }
  },
  relaySession: {
    relaySessionId: "verify-agent-cli-exec-session"
  }
});
const agentCliResult = await agentCliConnection.sendPrompt({
  relaySessionId: "verify-agent-cli-exec-session",
  relayTurnId: "verify-agent-cli-exec-turn",
  prompt: "delegated prompt text"
});
const capturedArgv = JSON.parse(await fs.readFile(argvCaptureLogPath, "utf8"));
assert.deepEqual(
  capturedArgv,
  ["--prompt", "delegated prompt text", "--format", "json"],
  "agent-cli-exec must replace {prompt} in argv without appending a duplicate prompt argument."
);
assert.equal(agentCliResult.finalResponsePolicy, "agent_cli_exec_stdout");
assert.match(agentCliResult.text, /delegated prompt text/);

const largeOutputScriptPath = path.join(tempRoot, "large-output.mjs");
await fs.writeFile(
  largeOutputScriptPath,
  "process.stdout.write('x'.repeat(512 * 1024));\n",
  "utf8"
);
const largeOutputConnection = createAgentCliExecConnection({
  target: {
    targetId: "verify.agent-cli-exec.large-output",
    transport: {
      type: "agent-cli-exec",
      command: {
        executable: process.execPath,
        args: [largeOutputScriptPath],
        timeoutMs: 30000
      }
    }
  },
  relaySession: {
    relaySessionId: "verify-agent-cli-exec-large-output-session"
  }
});
const largeOutputResult = await largeOutputConnection.sendPrompt({
  relaySessionId: "verify-agent-cli-exec-large-output-session",
  relayTurnId: "verify-agent-cli-exec-large-output-turn",
  prompt: "large output"
});
assert.equal(largeOutputResult.ok, true);
assert.ok(
  largeOutputResult.text.length <= 12000,
  "agent-cli-exec must not expose unbounded local CLI stdout"
);

const customRegisteredTargets = [];
const antigravityWrapperEnvSecret = "csrf-token-must-not-appear";
const customService = createDownstreamClientAspectService({
  env: { ...process.env, PATH: "" },
  targetRegistry: {
    upsertTarget(target) {
      customRegisteredTargets.push(target);
      return target;
    }
  },
  frameworkOverrides: [
    {
      frameworkId: "opencode",
      acp: {
        adapterId: "opencode-custom-acp-stdio",
        profileId: "pact.acp.opencode",
        transport: "stdio",
        command: {
          executable: "/opt/pact/bin/opencode-acp",
          args: ["--stdio"],
          env: {
            OPENCODE_TOKEN: "must-not-appear"
          }
        },
        advertisedTools: ["opencode.chat"],
        metadata: {
          public: {
            capabilitySet: "custom-opencode-acp"
          },
          secret: "must-not-appear"
        }
      }
    },
    {
      frameworkId: "antigravity",
      acp: {
        adapterId: "antigravity-agentapi-acp-stdio-wrapper",
        profileId: "pact.acp.antigravity.agentapi.wrapper",
        transport: "stdio",
        protocolStyle: "agent-client-protocol-v1",
        configurationStrategy: "pact-owned-agentapi-acp-wrapper",
        command: {
          executable: process.execPath,
          args: ["server/scripts/acp-agent-relay-antigravity-agentapi-acp-adapter.mjs"],
          cwd: process.cwd(),
          env: {
            PACT_ANTIGRAVITY_AGENTAPI_ACP_ADAPTER_CONFIG_JSON: JSON.stringify({
              csrfToken: antigravityWrapperEnvSecret
            })
          }
        },
        target: {
          targetId: "antigravity.agentapi-acp-wrapper:stdio",
          externalServiceId: "external.antigravity.agentapi.acp-wrapper"
        },
        virtualAgent: {
          virtualAgentId: "antigravity.agentapi-acp-wrapper"
        },
        advertisedTools: ["agentapi.sendMessage"],
        metadata: {
          public: {
            wrapper: "antigravity-agentapi-acp-stdio",
            nativeAntigravityAcp: false
          },
          secret: "must-not-appear"
        }
      }
    }
  ]
});
customService.start({ now: new Date("2026-06-05T00:00:00.000Z") });
const customOpenCodeAcp = customService
  .listCapabilities({ protocol: "acp", frameworkId: "opencode" })
  .at(0);
assert.equal(customOpenCodeAcp.status, "missing_dependency");
assert.equal(customOpenCodeAcp.adapterId, "opencode-custom-acp-stdio");
assert.equal(customOpenCodeAcp.capabilities.tools.includes("opencode.chat"), true);
assert.equal(customOpenCodeAcp.metadata.capabilitySet, "custom-opencode-acp");
assert.equal(JSON.stringify(customOpenCodeAcp).includes("must-not-appear"), false, "source-facing capability catalog must not expose ACP launch secrets.");
assert.equal(JSON.stringify(customOpenCodeAcp.metadata).includes("must-not-appear"), false, "Only public/safe metadata may be exposed.");
assert.equal(
  customRegisteredTargets.some((target) => target.transport?.command?.env?.OPENCODE_TOKEN === "must-not-appear"),
  true,
  "internal ACP target registry descriptor must retain launch env for target startup."
);
const customAntigravityWrapperAcp = customService
  .listCapabilities({ protocol: "acp", frameworkId: "antigravity" })
  .at(0);
assert.equal(customAntigravityWrapperAcp.status, "assembled");
assert.equal(customAntigravityWrapperAcp.adapterId, "antigravity-agentapi-acp-stdio-wrapper");
assert.equal(customAntigravityWrapperAcp.communication.transport, "stdio");
assert.equal(customAntigravityWrapperAcp.capabilities.configurationStrategy, "pact-owned-agentapi-acp-wrapper");
assert.equal(customAntigravityWrapperAcp.acpRelay.target.transport.protocolStyle, "agent-client-protocol-v1");
assert.equal(customAntigravityWrapperAcp.acpRelay.target.transport.command.executable, process.execPath);
assert.equal(customAntigravityWrapperAcp.acpRelay.target.transport.command.env, undefined);
assert.equal(customAntigravityWrapperAcp.acpRelay.target.metadata.public.wrapper, "antigravity-agentapi-acp-stdio");
assert.equal(customAntigravityWrapperAcp.acpRelay.target.metadata.public.nativeAntigravityAcp, false);
assert.equal(customAntigravityWrapperAcp.acpRelay.virtualAgent.metadata.public.nativeAntigravityAcp, false);
assert.equal(
  JSON.stringify(customAntigravityWrapperAcp).includes(antigravityWrapperEnvSecret),
  false,
  "source-facing Antigravity wrapper catalog must not expose Agent API credentials."
);
assert.equal(
  customRegisteredTargets.some((target) =>
    target.targetId === "antigravity.agentapi-acp-wrapper:stdio" &&
    target.transport?.command?.env?.PACT_ANTIGRAVITY_AGENTAPI_ACP_ADAPTER_CONFIG_JSON?.includes(antigravityWrapperEnvSecret)
  ),
  true,
  "internal Antigravity wrapper target descriptor must retain Agent API config env for target startup."
);

const mcpLayer = new McpAgentFrameworkAdapterLayer();
const acpLayer = new AcpAgentFrameworkAdapterLayer();
assert.equal(mcpLayer.supports(defaultDownstreamClientFrameworks().find((framework) => framework.frameworkId === "codex")), true);
assert.equal(acpLayer.supports(defaultDownstreamClientFrameworks().find((framework) => framework.frameworkId === "codex")), true);
assert.equal(acpLayer.supports(defaultDownstreamClientFrameworks().find((framework) => framework.frameworkId === "opencode")), true);
assert.equal(acpLayer.supports(defaultDownstreamClientFrameworks().find((framework) => framework.frameworkId === "kilo-code")), true);

console.log("[downstream-client-aspect] ok");
