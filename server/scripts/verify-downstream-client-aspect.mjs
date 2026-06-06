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
  resolveCommandCandidate
} from "../platform/common/downstream-client-aspect/index.mjs";

const CANONICAL_FRAMEWORKS = Object.freeze([
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

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-downstream-client-aspect-"));
const fixtureBin = path.join(tempRoot, "bin");
await fs.mkdir(fixtureBin, { recursive: true });
const codexAcpPath = path.join(fixtureBin, process.platform === "win32" ? "codex-acp.cmd" : "codex-acp");
await fs.writeFile(
  codexAcpPath,
  process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n",
  "utf8"
);
if (process.platform !== "win32") {
  await fs.chmod(codexAcpPath, 0o755);
}

const envWithCodexAcp = {
  ...process.env,
  PATH: `${fixtureBin}${path.delimiter}${process.env.PATH || ""}`
};

const frameworkIds = defaultDownstreamClientFrameworks().map((framework) => framework.frameworkId);
assert.deepEqual(frameworkIds, CANONICAL_FRAMEWORKS, "downstream client aspect framework catalog must match canonical agent targets.");

const commandProbe = resolveCommandCandidate(["codex-acp"], { env: envWithCodexAcp });
assert.equal(commandProbe.found, true, "fixture codex-acp command must be discoverable.");
assert.equal(commandProbe.path, codexAcpPath);

const registeredTargets = [];
const registeredVirtualAgents = [];
const { service, summary, capabilities } = assembleDownstreamClientAspect({
  env: envWithCodexAcp,
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

const codexMcp = capabilities.find((record) => record.frameworkId === "codex" && record.protocol === "mcp");
assert.equal(codexMcp.status, "assembled");
assert.equal(codexMcp.adapterId, "codex-mcp-cli");
assert.equal(codexMcp.profileId, "pact.mcp.codex");
assert.equal(codexMcp.capabilities.mcpInterfaceVersion, "pact.mcp.v1");

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

const kiloMcp = capabilities.find((record) => record.frameworkId === "kilo-code" && record.protocol === "mcp");
const kiloAcp = capabilities.find((record) => record.frameworkId === "kilo-code" && record.protocol === "acp");
assert.equal(kiloMcp.status, "assembled");
assert.equal(kiloMcp.adapterId, "kilo-code-mcp-config");
assert.equal(kiloAcp.status, "unavailable");
assert.equal(kiloAcp.reasonCode, "acp_adapter_not_declared");

const mcpRoute = service.translateInboundRequest({
  protocol: "mcp",
  frameworkId: "codex",
  method: "tools/call",
  input: { name: "pact.call" },
  context: { workspaceId: "workspace-1" }
});
assert.equal(mcpRoute.ok, true);
assert.equal(mcpRoute.routeTarget, "mcp-server-side");
assert.equal(mcpRoute.operationBoundary, "pact.tool-management.v1");
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
assert.equal(acpRoute.operationBoundary, "pact.acp-agent-relay.v1");
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
      frameworkId: "gemini-cli",
      acp: {
        adapterId: "gemini-custom-acp-stdio",
        profileId: "pact.acp.gemini-cli",
        transport: "stdio",
        command: {
          executable: "/opt/pact/bin/gemini-acp",
          args: ["--stdio"],
          env: {
            GEMINI_TOKEN: "must-not-appear"
          }
        },
        advertisedTools: ["gemini.chat"],
        metadata: {
          public: {
            capabilitySet: "custom-gemini-acp"
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
const customGeminiAcp = customService
  .listCapabilities({ protocol: "acp", frameworkId: "gemini-cli" })
  .at(0);
assert.equal(customGeminiAcp.status, "missing_dependency");
assert.equal(customGeminiAcp.adapterId, "gemini-custom-acp-stdio");
assert.equal(customGeminiAcp.capabilities.tools.includes("gemini.chat"), true);
assert.equal(customGeminiAcp.metadata.capabilitySet, "custom-gemini-acp");
assert.equal(JSON.stringify(customGeminiAcp).includes("must-not-appear"), false, "source-facing capability catalog must not expose ACP launch secrets.");
assert.equal(JSON.stringify(customGeminiAcp.metadata).includes("must-not-appear"), false, "Only public/safe metadata may be exposed.");
assert.equal(
  customRegisteredTargets.some((target) => target.transport?.command?.env?.GEMINI_TOKEN === "must-not-appear"),
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
assert.equal(acpLayer.supports(defaultDownstreamClientFrameworks().find((framework) => framework.frameworkId === "kilo-code")), false);

console.log("[downstream-client-aspect] ok");
