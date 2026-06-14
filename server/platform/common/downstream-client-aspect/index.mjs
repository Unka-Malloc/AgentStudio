import { accessSync, constants as fsConstants, existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const DOWNSTREAM_CLIENT_ASPECT_PROTOCOL_VERSION = "v0.0.1:agent:downstream-client-aspect-1";
export const DOWNSTREAM_CLIENT_ASPECT_SERVICE_KIND = "downstream-client-aspect";

export const DOWNSTREAM_CLIENT_ASPECT_ROUTE_TARGETS = Object.freeze({
  mcp: "mcp-server-side",
  acp: "acp-agent-relay"
});

const DEFAULT_PRIORITY_FRAMEWORKS = Object.freeze(["claude-code", "codex", "openclaw"]);

function relayCliParticipantAcp({
  frameworkId = "",
  label = "",
  commandNames = [],
  enabled = false,
  disabledReason = "operator_cli_command_required",
  command = {},
  advertisedTools = [],
  transportFidelity = "generic_cli_fallback",
  operatorConfigured = false,
  knownLimitation = "No verified native ACP transport or stable non-interactive task protocol is declared by default."
} = {}) {
  return {
    adapterId: `${frameworkId}-agent-cli-exec`,
    profileId: `pact.acp.${frameworkId}.agent-cli-exec`,
    transport: "agent-cli-exec",
    commandNames,
    configurationStrategy: "platform-governed-agent-cli-exec",
    targetRole: "source-or-target-agent",
    defaultMode: "ask",
    advertisedModes: ["ask"],
    advertisedModalities: ["text"],
    advertisedDataSources: ["workspace.files"],
    advertisedTools: advertisedTools.length > 0 ? advertisedTools : [`${frameworkId}.cli.exec`],
    reasoningVisibilityPolicy: "never",
    command: {
      timeoutMs: 240000,
      promptDelivery: "argument",
      ...command
    },
    target: {
      targetId: `${frameworkId}.agent-cli-exec:default`,
      label: `${label} Managed CLI Relay Target`,
      enabled,
      disabledReason,
      capabilityPolicy: {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      }
    },
    virtualAgent: {
      virtualAgentId: `${frameworkId}.agent-cli-exec-agent`,
      displayName: `${label} Relay Agent`,
      description: `${label} through Pact's governed local CLI relay participant path.`
    },
    metadata: {
      public: {
        relayParticipant: true,
        fallbackPolicy: "platform-governed-read-only-cli",
        transportFidelity,
        operatorConfigured,
        nativeAcpTargetSupported: false,
        knownLimitation
      }
    }
  };
}

function nativeAcpStdio({
  frameworkId = "",
  label = "",
  adapterId = "",
  profileId = "",
  commandNames = [],
  args = [],
  npxPackage = "",
  configurationStrategy = "",
  targetRole = "source-or-target-agent",
  defaultMode = "agent",
  advertisedTools = [],
  target = {},
  virtualAgent = {},
  metadata = {}
} = {}) {
  return {
    adapterId: asText(adapterId || `${frameworkId}-acp-stdio`),
    profileId: asText(profileId || `pact.acp.${frameworkId}`),
    transport: "stdio",
    protocolStyle: "agent-client-protocol-v1",
    commandNames,
    ...(npxPackage ? { npxPackage } : {}),
    command: {
      args: asArray(args).map(String)
    },
    configurationStrategy: asText(configurationStrategy || `${frameworkId}-native-acp-stdio`),
    targetRole,
    defaultMode,
    advertisedModes: ["ask", "agent"],
    advertisedModalities: ["text"],
    advertisedDataSources: ["workspace.files"],
    advertisedTools: advertisedTools.length > 0 ? advertisedTools : [`${frameworkId}.acp`],
    reasoningVisibilityPolicy: "never",
    target: {
      targetId: `${frameworkId}.acp:default`,
      label: `${label} ACP Target`,
      ...asObject(target)
    },
    virtualAgent: {
      virtualAgentId: `${frameworkId}.acp-agent`,
      displayName: `${label} ACP Agent`,
      description: `${label} through its Agent Client Protocol stdio interface.`,
      ...asObject(virtualAgent)
    },
    metadata: {
      public: {
        relayParticipant: true,
        nativeAcpTargetSupported: true,
        transportFidelity: "native_acp_stdio",
        ...publicMetadata(metadata)
      }
    }
  };
}

const DEFAULT_FRAMEWORKS = Object.freeze([
  {
    frameworkId: "openclaw",
    label: "OpenClaw",
    kind: "vm-cli",
    commandNames: ["openclaw", "ironclaw", "zeroclaw"],
    mcp: {
      adapterId: "openclaw-mcp-cli",
      profileId: "pact.mcp.openclaw",
      installMode: "openclaw-release-mcp-cli",
      locations: ["local", "orbstack", "remote-linux"],
      configurationStrategy: "cli-mcp-command"
    },
    acp: nativeAcpStdio({
      frameworkId: "openclaw",
      label: "OpenClaw",
      commandNames: ["openclaw", "ironclaw", "zeroclaw"],
      args: ["acp"],
      advertisedTools: ["openclaw.acp"],
      metadata: {
        public: {
          nativeOpenClawAcp: true,
          launchCommand: "openclaw acp"
        }
      }
    })
  },
  {
    frameworkId: "claude-code",
    label: "Claude Code",
    kind: "cli",
    commandNames: ["claude"],
    mcp: {
      adapterId: "claude-code-mcp-cli",
      profileId: "pact.mcp.claude-code",
      installMode: "claude-code-release-mcp-cli",
      locations: ["local", "orbstack", "remote-linux"],
      configurationStrategy: "cli-mcp-command"
    },
    acp: nativeAcpStdio({
      frameworkId: "claude-code",
      label: "Claude Code",
      adapterId: "claude-code-acp-stdio",
      profileId: "pact.acp.claude-code",
      commandNames: ["claude-code-acp"],
      npxPackage: "@zed-industries/claude-code-acp",
      configurationStrategy: "claude-code-acp-adapter",
      advertisedTools: ["claude-code.session", "claude-code.patch"],
      metadata: {
        public: {
          nativeClaudeCodeAcpAdapter: true,
          launchCommand: "claude-code-acp"
        }
      }
    })
  },
  {
    frameworkId: "codex",
    label: "Codex",
    kind: "cli",
    commandNames: ["codex"],
    mcp: {
      adapterId: "codex-mcp-cli",
      profileId: "pact.mcp.codex",
      installMode: "codex-release-plugin-and-mcp-cli",
      locations: ["local", "orbstack", "remote-linux"],
      configurationStrategy: "cli-mcp-command"
    },
    acp: {
      adapterId: "codex-acp-stdio",
      profileId: "pact.acp.codex",
      transport: "stdio",
      protocolStyle: "agent-client-protocol-v1",
      commandNames: ["codex-acp"],
      npxPackage: "@zed-industries/codex-acp",
      configurationStrategy: "codex-acp-adapter",
      targetRole: "source-or-target-agent",
      defaultMode: "agent",
      advertisedModes: ["ask", "agent"],
      advertisedModalities: ["text"],
      advertisedDataSources: ["workspace.files"],
      advertisedTools: ["codex.session", "codex.patch"],
      reasoningVisibilityPolicy: "never",
      metadata: {
        public: {
          relayParticipant: true,
          nativeCodexAcpAdapter: true
        }
      },
      fallback: {
        enabled: true,
        adapterId: "codex-cli-exec-fallback",
        profileId: "pact.acp.codex.cli-fallback",
        transport: "codex-cli-exec",
        configurationStrategy: "codex-cli-exec-fallback",
        commandNames: ["codex"],
        targetRole: "target-agent",
        defaultMode: "ask",
        advertisedModes: ["ask"],
        advertisedModalities: ["text"],
        advertisedDataSources: ["workspace.files"],
        advertisedTools: ["codex.exec"],
        reasoningVisibilityPolicy: "never",
        command: {
          sandbox: "read-only",
          timeoutMs: 240000
        },
        target: {
          targetId: "codex.cli-fallback:default",
          label: "Codex CLI Fallback Target"
        },
        virtualAgent: {
          virtualAgentId: "codex.cli-fallback-agent",
          displayName: "Codex CLI Fallback Agent",
          description: "Codex CLI through Pact's governed ACP Relay fallback."
        },
        metadata: {
          public: {
            relayParticipant: true,
            fallbackPolicy: "platform-governed-read-only-cli"
          }
        }
      }
    }
  },

  {
    frameworkId: "antigravity",
    label: "Antigravity",
    kind: "ide-agent",
    commandNames: ["agy", "antigravity-ide", "agy-ide", "antigravity"],
    mcp: {
      adapterId: "antigravity-mcp-config",
      profileId: "pact.mcp.antigravity",
      installMode: "antigravity-release-mcp-config",
      locations: ["local"],
      configurationStrategy: "desktop-mcp-config"
    },
    acp: {
      adapterId: "antigravity-agentapi",
      profileId: "pact.acp.antigravity",
      transport: "antigravity-agentapi",
      configurationStrategy: "antigravity-agentapi-connect",
      targetRole: "target-agent",
      defaultMode: "agent",
      advertisedModes: ["ask", "agent"],
      advertisedModalities: ["text"],
      advertisedDataSources: ["workspace.files"],
      advertisedTools: ["agentapi.sendMessage"],
      reasoningVisibilityPolicy: "never",
      connectObservationSupported: true,
      metadata: {
        public: {
          relayParticipant: true,
          transportFidelity: "agent_api_proxy",
          nativeAntigravityAcp: false
        }
      }
    }
  },
  {
    frameworkId: "opencode",
    label: "OpenCode",
    kind: "cli",
    commandNames: ["opencode"],
    mcp: {
      adapterId: "opencode-mcp-config",
      profileId: "pact.mcp.opencode",
      installMode: "opencode-release-mcp-config",
      locations: ["local", "orbstack", "remote-linux"],
      configurationStrategy: "json-mcp-config"
    },
    acp: {
      adapterId: "opencode-acp-stdio",
      profileId: "pact.acp.opencode",
      transport: "stdio",
      protocolStyle: "agent-client-protocol-v1",
      commandNames: ["opencode"],
      command: {
        args: ["acp"]
      },
      configurationStrategy: "opencode-native-acp-stdio",
      targetRole: "source-or-target-agent",
      defaultMode: "agent",
      advertisedModes: ["ask", "agent"],
      advertisedModalities: ["text"],
      advertisedDataSources: ["workspace.files"],
      advertisedTools: ["opencode.acp"],
      reasoningVisibilityPolicy: "never",
      target: {
        targetId: "opencode.acp:default",
        label: "OpenCode ACP Target"
      },
      virtualAgent: {
        virtualAgentId: "opencode.acp-agent",
        displayName: "OpenCode ACP Agent",
        description: "OpenCode through its native Agent Client Protocol stdio server."
      },
      metadata: {
        public: {
          relayParticipant: true,
          nativeOpenCodeAcp: true,
          launchCommand: "opencode acp"
        }
      }
    }
  },
  {
    frameworkId: "copilot",
    label: "Copilot",
    kind: "cli",
    commandNames: ["copilot"],
    mcp: {
      adapterId: "copilot-mcp-cli",
      profileId: "pact.mcp.copilot",
      installMode: "copilot-release-mcp-cli",
      locations: ["local", "orbstack", "remote-linux"],
      configurationStrategy: "cli-mcp-command"
    },
    acp: nativeAcpStdio({
      frameworkId: "copilot",
      label: "Copilot",
      commandNames: ["copilot"],
      args: ["--acp"],
      advertisedTools: ["copilot.acp"],
      metadata: {
        public: {
          nativeCopilotAcp: true,
          launchCommand: "copilot --acp"
        }
      }
    })
  },
  {
    frameworkId: "kilo-code",
    label: "Kilo Code",
    kind: "cli",
    commandNames: ["kilo"],
    mcp: {
      adapterId: "kilo-code-mcp-config",
      profileId: "pact.mcp.kilo-code",
      installMode: "kilo-release-global-kilo-json",
      locations: ["local", "orbstack", "remote-linux"],
      configurationStrategy: "json-mcp-config"
    },
    acp: nativeAcpStdio({
      frameworkId: "kilo-code",
      label: "Kilo Code",
      commandNames: ["kilo"],
      args: ["acp"],
      advertisedTools: ["kilo-code.acp"],
      metadata: {
        public: {
          nativeKiloCodeAcp: true,
          launchCommand: "kilo acp"
        }
      }
    })
  },
  {
    frameworkId: "cursor",
    label: "Cursor",
    kind: "desktop-agent",
    commandNames: ["cursor"],
    mcp: {
      adapterId: "cursor-mcp-config",
      profileId: "pact.mcp.cursor",
      installMode: "cursor-release-mcp-config",
      locations: ["local"],
      configurationStrategy: "desktop-mcp-config"
    },
    acp: nativeAcpStdio({
      frameworkId: "cursor",
      label: "Cursor",
      commandNames: ["cursor"],
      args: ["agent", "acp"],
      advertisedTools: ["cursor.acp"],
      metadata: {
        public: {
          nativeCursorAcp: true,
          launchCommand: "cursor agent acp"
        }
      }
    })
  },
  {
    frameworkId: "hermes",
    label: "Hermes Agent",
    kind: "vm-cli",
    commandNames: ["hermes"],
    mcp: {
      adapterId: "hermes-mcp-cli",
      profileId: "pact.mcp.hermes",
      installMode: "hermes-remote-mcp-cli",
      locations: ["orbstack", "remote-linux"],
      configurationStrategy: "remote-cli-mcp-command"
    },
    acp: nativeAcpStdio({
      frameworkId: "hermes",
      label: "Hermes Agent",
      commandNames: ["hermes"],
      args: ["acp"],
      advertisedTools: ["hermes.acp"],
      metadata: {
        public: {
          nativeHermesAcp: true,
          launchCommand: "hermes acp"
        }
      },
    })
  }
]);

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => asText(value)).filter(Boolean))];
}

function lowerToken(value = "") {
  return asText(value).toLowerCase().replace(/[\s_]+/g, "-");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function platformTargetKey({ platform = process.platform, arch = process.arch } = {}) {
  const os = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows"
  }[platform] || platform;
  const cpu = {
    arm64: "aarch64",
    x64: "x86_64"
  }[arch] || arch;
  return `${os}-${cpu}`;
}

function hasOwnField(value = {}, field = "") {
  return Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, field));
}

function mergeCommandConfig(base = {}, override = {}) {
  const baseCommand = asObject(base);
  const overrideCommand = asObject(override, null);
  if (!overrideCommand) {
    return cloneJson(baseCommand);
  }
  const merged = {
    ...cloneJson(baseCommand),
    ...cloneJson(overrideCommand)
  };
  for (const field of ["args", "promptArgs"]) {
    if (!hasOwnField(overrideCommand, field) && hasOwnField(baseCommand, field)) {
      merged[field] = cloneJson(baseCommand[field]);
    }
  }
  if (hasOwnField(baseCommand, "env") || hasOwnField(overrideCommand, "env")) {
    merged.env = {
      ...asObject(baseCommand.env),
      ...asObject(overrideCommand.env)
    };
  }
  return merged;
}

function normalizeAcpFallbackConfig(raw = null, frameworkId = "") {
  const fallback = asObject(raw, null);
  if (!fallback || fallback.enabled === false) {
    return null;
  }
  return Object.freeze({
    enabled: true,
    adapterId: asText(fallback.adapterId || `${frameworkId}-cli-exec-fallback`),
    profileId: asText(fallback.profileId || `pact.acp.${frameworkId}.cli-fallback`),
    transport: lowerToken(fallback.transport || fallback.transportType || "agent-cli-exec"),
    protocolStyle: asText(fallback.protocolStyle || fallback.protocolSchema || fallback.protocol || ""),
    targetRole: asText(fallback.targetRole || "target-agent"),
    commandNames: uniqueStrings(fallback.commandNames || fallback.commands),
    configurationStrategy: asText(fallback.configurationStrategy || "agent-cli-exec-fallback"),
    defaultMode: asText(fallback.defaultMode || "ask"),
    advertisedModes: uniqueStrings(fallback.advertisedModes || ["ask"]),
    advertisedModalities: uniqueStrings(fallback.advertisedModalities || ["text"]),
    advertisedDataSources: uniqueStrings(fallback.advertisedDataSources),
    advertisedTools: uniqueStrings(fallback.advertisedTools),
    reasoningVisibilityPolicy: asText(fallback.reasoningVisibilityPolicy || "never"),
    command: asObject(fallback.command),
    target: asObject(fallback.target),
    virtualAgent: asObject(fallback.virtualAgent),
    metadata: asObject(fallback.metadata),
    reasonCode: asText(fallback.reasonCode || "acp_adapter_unavailable_cli_fallback")
  });
}

function mergeProtocolConfig(base = {}, override = {}) {
  if (!override || typeof override !== "object") {
    return cloneJson(base || {});
  }
  const baseFallback = asObject(base.fallback || base.cliFallback || base.degradedFallback, null);
  const overrideFallback = asObject(override.fallback || override.cliFallback || override.degradedFallback, null);
  const merged = {
    ...cloneJson(base || {}),
    ...cloneJson(override),
    commandNames: uniqueStrings([...(base.commandNames || []), ...(override.commandNames || [])]),
    advertisedModes: uniqueStrings([...(base.advertisedModes || []), ...(override.advertisedModes || [])]),
    advertisedModalities: uniqueStrings([...(base.advertisedModalities || []), ...(override.advertisedModalities || [])]),
    advertisedDataSources: uniqueStrings([
      ...(base.advertisedDataSources || []),
      ...(override.advertisedDataSources || [])
    ]),
    advertisedTools: uniqueStrings([...(base.advertisedTools || []), ...(override.advertisedTools || [])]),
    locations: uniqueStrings([...(base.locations || []), ...(override.locations || [])])
  };
  if (baseFallback || overrideFallback) {
    merged.fallback = {
      ...cloneJson(baseFallback || {}),
      ...cloneJson(overrideFallback || {}),
      commandNames: uniqueStrings([...(baseFallback?.commandNames || []), ...(overrideFallback?.commandNames || [])]),
      advertisedModes: uniqueStrings([...(baseFallback?.advertisedModes || []), ...(overrideFallback?.advertisedModes || [])]),
      advertisedModalities: uniqueStrings([
        ...(baseFallback?.advertisedModalities || []),
        ...(overrideFallback?.advertisedModalities || [])
      ]),
      advertisedDataSources: uniqueStrings([
        ...(baseFallback?.advertisedDataSources || []),
        ...(overrideFallback?.advertisedDataSources || [])
      ]),
      advertisedTools: uniqueStrings([...(baseFallback?.advertisedTools || []), ...(overrideFallback?.advertisedTools || [])])
    };
  }
  if (base.command || override.command) {
    merged.command = mergeCommandConfig(base.command, override.command);
  }
  return merged;
}

function mergeFramework(base = {}, override = {}) {
  const merged = {
    ...cloneJson(base || {}),
    ...cloneJson(override || {}),
    frameworkId: asText(override.frameworkId || override.id || base.frameworkId || base.id),
    commandNames: uniqueStrings([...(base.commandNames || []), ...(override.commandNames || [])])
  };
  if (base.mcp || override.mcp) {
    merged.mcp = mergeProtocolConfig(base.mcp, override.mcp);
  }
  if (base.acp || override.acp) {
    merged.acp = mergeProtocolConfig(base.acp, override.acp);
  }
  return normalizeFrameworkDefinition(merged);
}

function defaultFrameworkMap() {
  return new Map(DEFAULT_FRAMEWORKS.map((framework) => [framework.frameworkId, cloneJson(framework)]));
}

function normalizeRegistryAgents(raw = {}) {
  const registry = asObject(raw, null);
  if (!registry) {
    return [];
  }
  if (Array.isArray(registry)) {
    return registry;
  }
  if (Array.isArray(registry.agents)) {
    return registry.agents;
  }
  if (Array.isArray(registry.entries)) {
    return registry.entries;
  }
  return [];
}

function registryDistributionForHost(agent = {}, options = {}) {
  const distribution = asObject(agent.distribution, null);
  if (!distribution) {
    return null;
  }
  const key = platformTargetKey(options);
  const binary = asObject(distribution.binary, null);
  const binaryTarget = asObject(binary?.[key], null);
  if (binaryTarget?.cmd) {
    return {
      type: "binary",
      executable: asText(binaryTarget.cmd),
      args: asArray(binaryTarget.args).map(String),
      env: asObject(binaryTarget.env),
      archive: asText(binaryTarget.archive),
      platformTarget: key
    };
  }
  const npx = asObject(distribution.npx, null);
  if (npx?.package) {
    return {
      type: "npx",
      packageName: asText(npx.package),
      executable: "npx",
      args: ["--yes", asText(npx.package), ...asArray(npx.args).map(String)],
      env: asObject(npx.env)
    };
  }
  const uvx = asObject(distribution.uvx, null);
  if (uvx?.package) {
    return {
      type: "uvx",
      packageName: asText(uvx.package),
      executable: "uvx",
      args: [asText(uvx.package), ...asArray(uvx.args).map(String)],
      env: asObject(uvx.env)
    };
  }
  return null;
}

function frameworkFromAcpRegistryAgent(agent = {}, options = {}) {
  const id = lowerToken(agent.id || agent.name);
  const label = asText(agent.name || agent.label || id);
  if (!id || !label) {
    return null;
  }
  const distribution = registryDistributionForHost(agent, options);
  if (!distribution) {
    return null;
  }
  const command = {
    args: distribution.args,
    ...(Object.keys(distribution.env || {}).length > 0 ? { env: distribution.env } : {})
  };
  if (distribution.type === "binary" && path.isAbsolute(distribution.executable)) {
    command.executable = distribution.executable;
  }
  const commandNames = [distribution.executable].filter(Boolean);
  return {
    frameworkId: id,
    label,
    kind: "acp-registry-agent",
    commandNames,
    metadata: {
      public: {
        source: "acp-registry",
        registryAgentId: id,
        registryVersion: asText(agent.version),
        registryDistributionType: distribution.type
      }
    },
    acp: {
      adapterId: `${id}-acp-registry-stdio`,
      profileId: `pact.acp.registry.${id}`,
      transport: "stdio",
      protocolStyle: "agent-client-protocol-v1",
      commandNames,
      command,
      configurationStrategy: "acp-registry-distribution",
      targetRole: "source-or-target-agent",
      defaultMode: "agent",
      advertisedModes: ["ask", "agent"],
      advertisedModalities: ["text"],
      advertisedDataSources: ["workspace.files"],
      advertisedTools: [`${id}.acp`],
      reasoningVisibilityPolicy: "never",
      target: {
        targetId: `${id}.acp-registry:default`,
        label: `${label} ACP Registry Target`
      },
      virtualAgent: {
        virtualAgentId: `${id}.acp-registry-agent`,
        displayName: `${label} ACP Agent`,
        description: `${label} imported from an ACP Registry manifest.`
      },
      metadata: {
        public: {
          relayParticipant: true,
          registryImported: true,
          registryAgentId: id,
          registryVersion: asText(agent.version),
          registryDistributionType: distribution.type,
          nativeAcpTargetSupported: true,
          transportFidelity: "native_acp_stdio"
        }
      }
    }
  };
}

export function downstreamClientFrameworksFromAcpRegistries(registries = [], options = {}) {
  const frameworks = [];
  for (const registry of asArray(registries)) {
    for (const agent of normalizeRegistryAgents(registry)) {
      const framework = frameworkFromAcpRegistryAgent(agent, options);
      if (framework) {
        frameworks.push(framework);
      }
    }
  }
  return frameworks;
}

function readJsonFileIfPossible(filePath = "") {
  const resolved = asText(filePath);
  if (!resolved) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch {
    return null;
  }
}

function acpRegistryInputsFromEnv(env = process.env) {
  const registries = [];
  const inlineJson = asText(env.PACT_ACP_AGENT_REGISTRY_JSON);
  if (inlineJson) {
    try {
      registries.push(JSON.parse(inlineJson));
    } catch {
      registries.push({ agents: [] });
    }
  }
  for (const filePath of uniqueStrings([
    asText(env.PACT_ACP_AGENT_REGISTRY_PATH),
    ...asText(env.PACT_ACP_AGENT_REGISTRY_PATHS)
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean)
  ])) {
    const registry = readJsonFileIfPossible(filePath);
    if (registry) {
      registries.push(registry);
    }
  }
  return registries;
}

export function normalizeFrameworkDefinition(raw = {}) {
  const frameworkId = lowerToken(raw.frameworkId || raw.id);
  const label = asText(raw.label || raw.name || frameworkId);
  return Object.freeze({
    frameworkId,
    label,
    kind: asText(raw.kind, "agent-framework"),
    commandNames: uniqueStrings(raw.commandNames || raw.commands || raw.binaryNames),
    metadata: asObject(raw.metadata),
    mcp: raw.mcp ? Object.freeze({
      adapterId: asText(raw.mcp.adapterId || `${frameworkId}-mcp-adapter`),
      profileId: asText(raw.mcp.profileId || `pact.mcp.${frameworkId}`),
      installMode: asText(raw.mcp.installMode || "manual"),
      locations: uniqueStrings(raw.mcp.locations || ["local"]),
      configurationStrategy: asText(raw.mcp.configurationStrategy || "mcp-config"),
      serverName: asText(raw.mcp.serverName || "pact"),
      commandNames: uniqueStrings(raw.mcp.commandNames || raw.commandNames),
      metadata: asObject(raw.mcp.metadata)
    }) : null,
    acp: raw.acp ? Object.freeze({
      adapterId: asText(raw.acp.adapterId || `${frameworkId}-acp-adapter`),
      profileId: asText(raw.acp.profileId || `pact.acp.${frameworkId}`),
      transport: lowerToken(raw.acp.transport || "stdio"),
      protocolStyle: asText(raw.acp.protocolStyle || raw.acp.protocolSchema || raw.acp.protocol || ""),
      targetRole: asText(raw.acp.targetRole || "target-agent"),
      commandNames: uniqueStrings(raw.acp.commandNames || raw.acp.commands),
      npxPackage: asText(raw.acp.npxPackage),
      configurationStrategy: asText(raw.acp.configurationStrategy || "acp-config"),
      defaultMode: asText(raw.acp.defaultMode || "ask"),
      advertisedModes: uniqueStrings(raw.acp.advertisedModes || ["ask"]),
      advertisedModalities: uniqueStrings(raw.acp.advertisedModalities || ["text"]),
      advertisedDataSources: uniqueStrings(raw.acp.advertisedDataSources),
      advertisedTools: uniqueStrings(raw.acp.advertisedTools),
      reasoningVisibilityPolicy: asText(raw.acp.reasoningVisibilityPolicy || "never"),
      connectObservationSupported: raw.acp.connectObservationSupported === true,
      command: asObject(raw.acp.command),
      target: asObject(raw.acp.target),
      virtualAgent: asObject(raw.acp.virtualAgent),
      fallback: normalizeAcpFallbackConfig(
        raw.acp.fallback || raw.acp.cliFallback || raw.acp.degradedFallback,
        frameworkId
      ),
      metadata: asObject(raw.acp.metadata)
    }) : null
  });
}

export function defaultDownstreamClientFrameworks(overrides = [], options = {}) {
  const byId = defaultFrameworkMap();
  const registryFrameworks = downstreamClientFrameworksFromAcpRegistries(options.acpRegistries, options);
  for (const framework of registryFrameworks) {
    if (!framework.frameworkId) {
      continue;
    }
    byId.set(framework.frameworkId, mergeFramework(byId.get(framework.frameworkId) || {}, framework));
  }
  for (const override of asArray(overrides)) {
    const id = lowerToken(override.frameworkId || override.id);
    if (!id) {
      continue;
    }
    byId.set(id, mergeFramework(byId.get(id) || {}, override));
  }
  return [...byId.values()].map(normalizeFrameworkDefinition);
}

function pathEntries(env = process.env) {
  return asText(env.PATH)
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function defaultLocalBinEntries({ cwd = process.cwd(), localBinDirs = [], includeDefaultLocalBin = true } = {}) {
  return uniqueStrings([
    ...asArray(localBinDirs),
    ...(includeDefaultLocalBin === false ? [] : [path.join(asText(cwd, process.cwd()), "node_modules", ".bin")])
  ]);
}

function executableExists(filePath = "") {
  const candidate = asText(filePath);
  if (!candidate || !existsSync(candidate)) {
    return false;
  }
  try {
    accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveCommandCandidate(commandNames = [], { env = process.env, platform = process.platform } = {}) {
  const names = uniqueStrings(commandNames);
  const options = arguments[1] || {};
  for (const name of names) {
    if (path.isAbsolute(name) || name.includes(path.sep)) {
      if (executableExists(name)) {
        return { found: true, command: name, path: name };
      }
      continue;
    }
    const suffixes = platform === "win32" ? ["", ".cmd", ".exe", ".bat"] : [""];
    const searchDirs = uniqueStrings([
      ...pathEntries(env),
      ...defaultLocalBinEntries(options)
    ]);
    for (const dir of searchDirs) {
      for (const suffix of suffixes) {
        const candidate = path.join(dir, `${name}${suffix}`);
        if (executableExists(candidate)) {
          return { found: true, command: name, path: candidate };
        }
      }
    }
  }
  return { found: false, command: names[0] || "", path: "" };
}

function publicMetadata(metadata = {}) {
  const raw = asObject(metadata);
  return asObject(raw.public || raw.safe);
}

function protocolRecordBase({ layerId, framework, protocolConfig, sequence = 0, assembledAt = "" }) {
  return {
    aspectProtocolVersion: DOWNSTREAM_CLIENT_ASPECT_PROTOCOL_VERSION,
    serviceKind: DOWNSTREAM_CLIENT_ASPECT_SERVICE_KIND,
    layerId,
    protocol: layerId,
    frameworkId: framework.frameworkId,
    frameworkLabel: framework.label,
    frameworkKind: framework.kind,
    adapterId: protocolConfig.adapterId,
    profileId: protocolConfig.profileId,
    startup: {
      sequence,
      assembledAt
    }
  };
}

export class McpAgentFrameworkAdapterLayer {
  constructor({ layerId = "mcp", adapterKind = "agent-framework-mcp-adapter-layer" } = {}) {
    this.layerId = layerId;
    this.adapterKind = adapterKind;
  }

  supports(framework = {}) {
    return Boolean(framework?.mcp);
  }

  assembleFramework(framework = {}, context = {}) {
    const mcp = framework.mcp;
    if (!mcp) {
      return {
        aspectProtocolVersion: DOWNSTREAM_CLIENT_ASPECT_PROTOCOL_VERSION,
        serviceKind: DOWNSTREAM_CLIENT_ASPECT_SERVICE_KIND,
        layerId: this.layerId,
        protocol: "mcp",
        frameworkId: framework.frameworkId,
        frameworkLabel: framework.label,
        status: "unavailable",
        reasonCode: "mcp_adapter_not_declared",
        startup: {
          sequence: context.sequence || 0,
          assembledAt: context.assembledAt || ""
        }
      };
    }
    const commandProbe = resolveCommandCandidate(uniqueStrings([...framework.commandNames, ...mcp.commandNames]), context);
    return Object.freeze({
      ...protocolRecordBase({
        layerId: this.layerId,
        framework,
        protocolConfig: mcp,
        sequence: context.sequence || 0,
        assembledAt: context.assembledAt || ""
      }),
      adapterKind: this.adapterKind,
      status: "assembled",
      reasonCode: "",
      communication: {
        protocol: "mcp",
        direction: "agent-to-pact",
        transport: "client-config",
        targetRole: "downstream-client"
      },
      commandProbe,
      capabilities: {
        serverName: mcp.serverName,
        installMode: mcp.installMode,
        locations: [...mcp.locations],
        configurationStrategy: mcp.configurationStrategy,
        canInstall: true,
        canScan: true,
        canRepair: true,
        toolBoundary: "v0.0.1:tool:management-1",
        mcpInterfaceVersion: "v0.0.1:mcp:interface-1"
      },
      metadata: publicMetadata(mcp.metadata)
    });
  }
}

function acpMissingStatus(acp = {}, commandProbe = {}) {
  if (["antigravity-agentapi", "antigravity.agentapi", "agentapi"].includes(acp.transport)) {
    return { status: "assembled", reasonCode: "" };
  }
  if (acp.command?.executable) {
    return executableExists(acp.command.executable)
      ? { status: "assembled", reasonCode: "" }
      : { status: "missing_dependency", reasonCode: "acp_adapter_command_not_found" };
  }
  if (commandProbe.found) {
    return { status: "assembled", reasonCode: "" };
  }
  if (acp.npxPackage) {
    return { status: "installable", reasonCode: "acp_adapter_package_not_installed" };
  }
  return { status: "missing_dependency", reasonCode: "acp_adapter_command_not_found" };
}

function acpStatusEnabled(status = "") {
  return ["assembled", "degraded"].includes(asText(status));
}

function acpCliFallbackConfig(acp = {}) {
  const fallback = asObject(acp.fallback, null);
  return fallback?.enabled === true ? fallback : null;
}

function acpCommandDetails(command = {}, { includeEnv = true } = {}) {
  const input = asObject(command);
  const details = {
    args: asArray(input.args).map(String),
    ...(includeEnv ? { env: asObject(input.env) } : {}),
    cwd: asText(input.cwd)
  };
  const promptArgs = asArray(input.promptArgs).map(String);
  if (promptArgs.length > 0) {
    details.promptArgs = promptArgs;
  }
  for (const field of [
    "promptDelivery",
    "sandbox",
    "model"
  ]) {
    const value = asText(input[field]);
    if (value) {
      details[field] = value;
    }
  }
  for (const field of [
    "timeoutMs",
    "bypassSandbox",
    "ignoreRules",
    "ignoreUserConfig",
    "skipGitRepoCheck"
  ]) {
    if (input[field] !== undefined) {
      details[field] = input[field];
    }
  }
  return details;
}

function acpTransportCommand(acp = {}, commandProbe = {}, { includeEnv = true } = {}) {
  const details = acpCommandDetails(acp.command, { includeEnv });
  if (acp.command?.executable) {
    return {
      executable: asText(acp.command.executable),
      ...details
    };
  }
  if (commandProbe.found) {
    return {
      executable: commandProbe.path,
      ...details
    };
  }
  if (acp.npxPackage) {
    return {
      executable: "npx",
      args: ["--yes", acp.npxPackage],
      ...(includeEnv ? { env: {} } : {}),
      cwd: ""
    };
  }
  return null;
}

function acpRelayTargetDescriptor(framework = {}, acp = {}, status = "", command = null, degradation = null) {
  const target = asObject(acp.target);
  const safeMetadata = publicMetadata(acp.metadata);
  const targetId = asText(target.targetId || `${framework.frameworkId}.acp:default`);
  const transport = {
    type: acp.transport,
    ...(acp.protocolStyle ? { protocolStyle: acp.protocolStyle } : {}),
    timeoutMs: Number(target.transport?.timeoutMs || acp.target?.timeoutMs || 0) || 120000
  };
  if (command && ["stdio", "codex-cli-exec", "agent-cli-exec", "local-cli-exec", "cli-exec"].includes(acp.transport)) {
    transport.command = command;
  }
  if (acp.transport === "antigravity-agentapi") {
    transport.connectEnabled = acp.connectObservationSupported === true;
  }
  if (degradation) {
    transport.degraded = true;
    transport.degradedFromTransport = asText(degradation.preferredTransport);
    transport.degradationReasonCode = asText(degradation.reasonCode);
  }
  return {
    targetId,
    label: asText(target.label || `${framework.label} ACP Target`),
    transport,
    agentProfileId: acp.profileId,
    enabled: acpStatusEnabled(status) && target.enabled !== false,
    disabledReason: target.enabled === false
      ? asText(target.disabledReason || target.disabledReasonCode || "target_disabled")
      : (acpStatusEnabled(status) ? "" : status),
    externalServiceId: asText(target.externalServiceId || `external.agent-framework.${framework.frameworkId}.acp`),
    capabilityPolicy: {
      writes: asText(target.capabilityPolicy?.writes || "deny"),
      terminal: asText(target.capabilityPolicy?.terminal || "deny"),
      maxRisk: asText(target.capabilityPolicy?.maxRisk || "read_only")
    },
    advertisedToolsets: [...acp.advertisedTools],
    metadata: {
      public: {
        fromAspect: "downstream-client-aspect",
        aspectProtocolVersion: DOWNSTREAM_CLIENT_ASPECT_PROTOCOL_VERSION,
        serviceKind: DOWNSTREAM_CLIENT_ASPECT_SERVICE_KIND,
        frameworkId: framework.frameworkId,
        adapterId: acp.adapterId,
        protocol: "acp",
        ...safeMetadata,
        ...(degradation ? { degraded: true, degradation } : {})
      }
    }
  };
}

function acpRelayVirtualAgentDescriptor(framework = {}, acp = {}, targetDescriptor = {}) {
  const virtualAgent = asObject(acp.virtualAgent);
  const safeMetadata = publicMetadata(acp.metadata);
  return {
    virtualAgentId: asText(virtualAgent.virtualAgentId || `${framework.frameworkId}.acp-agent`),
    targetId: targetDescriptor.targetId,
    profileId: acp.profileId,
    displayName: asText(virtualAgent.displayName || `${framework.label} ACP Agent`),
    description: asText(virtualAgent.description || `${framework.label} through the downstream client aspect ACP layer.`),
    advertisedModes: [...acp.advertisedModes],
    defaultMode: acp.defaultMode,
    advertisedModalities: [...acp.advertisedModalities],
    advertisedDataSources: [...acp.advertisedDataSources],
    advertisedTools: [...acp.advertisedTools],
    visibilityPolicy: asText(virtualAgent.visibilityPolicy || "public"),
    reasoningVisibilityPolicy: acp.reasoningVisibilityPolicy,
    capabilityPolicy: {
      writes: targetDescriptor.capabilityPolicy.writes,
      terminal: targetDescriptor.capabilityPolicy.terminal,
      maxRisk: targetDescriptor.capabilityPolicy.maxRisk
    },
    enabled: targetDescriptor.enabled === true,
    metadata: {
      public: {
        fromAspect: "downstream-client-aspect",
        aspectProtocolVersion: DOWNSTREAM_CLIENT_ASPECT_PROTOCOL_VERSION,
        serviceKind: DOWNSTREAM_CLIENT_ASPECT_SERVICE_KIND,
        frameworkId: framework.frameworkId,
        adapterId: acp.adapterId,
        protocol: "acp",
        ...safeMetadata
      }
    }
  };
}

function governedCliFallbackTarget(target = {}, framework = {}) {
  return {
    ...asObject(target),
    targetId: asText(target.targetId || `${framework.frameworkId}.cli-fallback:default`),
    label: asText(target.label || `${framework.label} CLI Fallback Target`),
    capabilityPolicy: {
      writes: "deny",
      terminal: "deny",
      maxRisk: "read_only"
    }
  };
}

function acpFallbackEffectiveConfig({ framework = {}, acp = {}, fallback = {}, reasonCode = "" } = {}) {
  const degradation = {
    active: true,
    reasonCode: asText(reasonCode || fallback.reasonCode || "acp_adapter_unavailable_cli_fallback"),
    preferredAdapterId: asText(acp.adapterId),
    preferredTransport: asText(acp.transport),
    fallbackAdapterId: asText(fallback.adapterId),
    fallbackTransport: asText(fallback.transport),
    policy: "platform-governed-read-only-cli"
  };
  const fallbackMetadata = publicMetadata(fallback.metadata);
  return {
    effectiveAcp: {
      ...fallback,
      adapterId: fallback.adapterId,
      profileId: fallback.profileId,
      transport: fallback.transport,
      protocolStyle: fallback.protocolStyle,
      targetRole: fallback.targetRole,
      commandNames: [...fallback.commandNames],
      npxPackage: "",
      configurationStrategy: fallback.configurationStrategy,
      defaultMode: fallback.defaultMode,
      advertisedModes: [...fallback.advertisedModes],
      advertisedModalities: [...fallback.advertisedModalities],
      advertisedDataSources: [...fallback.advertisedDataSources],
      advertisedTools: [...fallback.advertisedTools],
      reasoningVisibilityPolicy: fallback.reasoningVisibilityPolicy,
      command: asObject(fallback.command),
      target: governedCliFallbackTarget(fallback.target, framework),
      virtualAgent: asObject(fallback.virtualAgent),
      connectObservationSupported: false,
      metadata: {
        public: {
          ...publicMetadata(acp.metadata),
          ...fallbackMetadata,
          degraded: true,
          degradation
        }
      }
    },
    degradation
  };
}

export class AcpAgentFrameworkAdapterLayer {
  constructor({ layerId = "acp", adapterKind = "agent-framework-acp-adapter-layer" } = {}) {
    this.layerId = layerId;
    this.adapterKind = adapterKind;
  }

  supports(framework = {}) {
    return Boolean(framework?.acp);
  }

  assembleFramework(framework = {}, context = {}) {
    const acp = framework.acp;
    if (!acp) {
      return Object.freeze({
        aspectProtocolVersion: DOWNSTREAM_CLIENT_ASPECT_PROTOCOL_VERSION,
        serviceKind: DOWNSTREAM_CLIENT_ASPECT_SERVICE_KIND,
        layerId: this.layerId,
        protocol: "acp",
        frameworkId: framework.frameworkId,
        frameworkLabel: framework.label,
        status: "unavailable",
        reasonCode: "acp_adapter_not_declared",
        startup: {
          sequence: context.sequence || 0,
          assembledAt: context.assembledAt || ""
        }
      });
    }
    const commandProbe = resolveCommandCandidate(acp.commandNames, context);
    const primaryStatus = acpMissingStatus(acp, commandProbe);
    let status = primaryStatus.status;
    let reasonCode = primaryStatus.reasonCode;
    let effectiveAcp = acp;
    let effectiveCommandProbe = commandProbe;
    let fallbackProbe = null;
    let degradation = null;
    const fallback = acpCliFallbackConfig(acp);
    if (status !== "assembled" && fallback) {
      fallbackProbe = resolveCommandCandidate(fallback.commandNames, context);
      const fallbackStatus = acpMissingStatus(fallback, fallbackProbe);
      if (fallbackStatus.status === "assembled") {
        const fallbackEffective = acpFallbackEffectiveConfig({
          framework,
          acp,
          fallback,
          reasonCode: primaryStatus.reasonCode || fallback.reasonCode
        });
        effectiveAcp = fallbackEffective.effectiveAcp;
        effectiveCommandProbe = fallbackProbe;
        degradation = fallbackEffective.degradation;
        status = "degraded";
        reasonCode = fallback.reasonCode;
      }
    }
    const internalCommand = acpTransportCommand(effectiveAcp, effectiveCommandProbe, { includeEnv: true });
    const publicCommand = acpTransportCommand(effectiveAcp, effectiveCommandProbe, { includeEnv: false });
    const targetDescriptor = acpRelayTargetDescriptor(framework, effectiveAcp, status, publicCommand, degradation);
    const internalTargetDescriptor = acpRelayTargetDescriptor(framework, effectiveAcp, status, internalCommand, degradation);
    const virtualAgentDescriptor = acpRelayVirtualAgentDescriptor(framework, effectiveAcp, targetDescriptor);
    const record = {
      ...protocolRecordBase({
        layerId: this.layerId,
        framework,
        protocolConfig: effectiveAcp,
        sequence: context.sequence || 0,
        assembledAt: context.assembledAt || ""
      }),
      adapterKind: this.adapterKind,
      status,
      reasonCode,
      communication: {
        protocol: "acp",
        direction: "agent-to-agent-through-pact",
        transport: effectiveAcp.transport,
        targetRole: effectiveAcp.targetRole,
        ...(degradation ? {
          degraded: true,
          preferredTransport: degradation.preferredTransport,
          fallbackTransport: degradation.fallbackTransport
        } : {})
      },
      commandProbe: effectiveCommandProbe,
      primaryCommandProbe: commandProbe,
      ...(fallbackProbe ? { fallbackCommandProbe: fallbackProbe } : {}),
      capabilities: {
        configurationStrategy: effectiveAcp.configurationStrategy,
        installPackage: effectiveAcp.npxPackage || "",
        modes: [...effectiveAcp.advertisedModes],
        defaultMode: effectiveAcp.defaultMode,
        modalities: [...effectiveAcp.advertisedModalities],
        dataSources: [...effectiveAcp.advertisedDataSources],
        tools: [...effectiveAcp.advertisedTools],
        reasoningVisibilityPolicy: effectiveAcp.reasoningVisibilityPolicy,
        connectObservationSupported: effectiveAcp.connectObservationSupported === true,
        protocolBoundary: "v0.0.1:agent:acp-agent-relay-1",
        degraded: degradation?.active === true,
        ...(degradation ? { degradation } : {})
      },
      acpRelay: {
        target: targetDescriptor,
        virtualAgent: virtualAgentDescriptor
      },
      metadata: publicMetadata(effectiveAcp.metadata)
    };
    Object.defineProperty(record, "_internalAcpRelay", {
      value: {
        target: internalTargetDescriptor,
        virtualAgent: virtualAgentDescriptor
      },
      enumerable: false
    });
    return Object.freeze(record);
  }
}

export function createDefaultDownstreamClientAspectLayers() {
  return [
    new McpAgentFrameworkAdapterLayer(),
    new AcpAgentFrameworkAdapterLayer()
  ];
}

export class DownstreamClientAspectService {
  constructor({
    serviceId = "pact.downstream-client-aspect",
    frameworks = null,
    frameworkOverrides = [],
    acpRegistries = [],
    acpRegistry = null,
    acpRegistryEntries = [],
    acpRegistryPaths = [],
    layers = null,
    targetRegistry = null,
    virtualAgentRegistry = null,
    registerAcpRelayDescriptors = true,
    env = process.env,
    cwd = process.cwd(),
    localBinDirs = [],
    includeDefaultLocalBin = true,
    logger = null
  } = {}) {
    this.serviceId = serviceId;
    const explicitRegistries = [
      ...(acpRegistry ? [acpRegistry] : []),
      ...asArray(acpRegistries),
      ...(asArray(acpRegistryEntries).length > 0 ? [{ agents: acpRegistryEntries }] : []),
      ...asArray(acpRegistryPaths).map(readJsonFileIfPossible).filter(Boolean),
      ...acpRegistryInputsFromEnv(env)
    ];
    this.frameworks = (frameworks || defaultDownstreamClientFrameworks(frameworkOverrides, {
      acpRegistries: explicitRegistries,
      platform: process.platform,
      arch: process.arch
    })).map(normalizeFrameworkDefinition);
    this.layers = layers || createDefaultDownstreamClientAspectLayers();
    this.targetRegistry = targetRegistry;
    this.virtualAgentRegistry = virtualAgentRegistry;
    this.registerAcpRelayDescriptors = registerAcpRelayDescriptors !== false;
    this.env = env;
    this.cwd = cwd;
    this.localBinDirs = localBinDirs;
    this.includeDefaultLocalBin = includeDefaultLocalBin !== false;
    this.logger = logger;
    this.started = false;
    this.assemblies = [];
  }

  listProtocolLayers() {
    return this.layers.map((layer) => Object.freeze({
      layerId: layer.layerId,
      adapterKind: layer.adapterKind
    }));
  }

  start({ now = new Date() } = {}) {
    const assembledAt = now.toISOString();
    const assemblies = [];
    let sequence = 0;
    for (const framework of this.frameworks) {
      for (const layer of this.layers) {
        sequence += 1;
        const record = layer.assembleFramework(framework, {
          env: this.env,
          cwd: this.cwd,
          localBinDirs: this.localBinDirs,
          includeDefaultLocalBin: this.includeDefaultLocalBin,
          sequence,
          assembledAt
        });
        assemblies.push(record);
        this.registerRecord(record);
      }
    }
    this.assemblies = assemblies;
    this.started = true;
    if (this.logger && typeof this.logger.info === "function") {
      this.logger.info("Downstream client aspect assembled protocol adapters.", {
        serviceId: this.serviceId,
        frameworkCount: this.frameworks.length,
        layerCount: this.layers.length,
        assemblyCount: assemblies.length
      });
    }
    return this.summary();
  }

  registerRecord(record = {}) {
    if (!this.registerAcpRelayDescriptors || record.protocol !== "acp" || !record.acpRelay) {
      return;
    }
    const acpRelay = record._internalAcpRelay || record.acpRelay;
    if (this.targetRegistry && typeof this.targetRegistry.upsertTarget === "function") {
      this.targetRegistry.upsertTarget(acpRelay.target);
    }
    if (this.virtualAgentRegistry && typeof this.virtualAgentRegistry.upsertAgent === "function") {
      this.virtualAgentRegistry.upsertAgent(acpRelay.virtualAgent);
    }
  }

  listCapabilities({ protocol = "", frameworkId = "", includeUnavailable = true } = {}) {
    const protocolFilter = lowerToken(protocol);
    const frameworkFilter = lowerToken(frameworkId);
    return this.assemblies.filter((record) => {
      if (!includeUnavailable && record.status === "unavailable") {
        return false;
      }
      if (protocolFilter && record.protocol !== protocolFilter) {
        return false;
      }
      if (frameworkFilter && record.frameworkId !== frameworkFilter) {
        return false;
      }
      return true;
    });
  }

  translateInboundRequest({ protocol = "", method = "", input = {}, context = {}, frameworkId = "" } = {}) {
    const normalizedProtocol = lowerToken(protocol);
    const routeTarget = DOWNSTREAM_CLIENT_ASPECT_ROUTE_TARGETS[normalizedProtocol];
    if (!routeTarget) {
      return Object.freeze({
        ok: false,
        serviceKind: DOWNSTREAM_CLIENT_ASPECT_SERVICE_KIND,
        protocol: normalizedProtocol,
        reasonCode: "downstream_protocol_not_supported"
      });
    }

    const candidate = this.listCapabilities({
      protocol: normalizedProtocol,
      frameworkId,
      includeUnavailable: true
    }).find((record) => !frameworkId || record.frameworkId === lowerToken(frameworkId));

    return Object.freeze({
      ok: true,
      serviceKind: DOWNSTREAM_CLIENT_ASPECT_SERVICE_KIND,
      protocol: normalizedProtocol,
      routeTarget,
      routeIntent: {
        routeTarget,
        method: asText(method),
        input: cloneJson(input),
        context: cloneJson(context),
        frameworkId: lowerToken(frameworkId),
        adapterId: candidate?.adapterId || "",
        profileId: candidate?.profileId || ""
      },
      executionBoundary: "translate-only",
      authorizationBoundary: "platform-service",
      operationBoundary: normalizedProtocol === "mcp" ? "v0.0.1:tool:management-1" : "v0.0.1:agent:acp-agent-relay-1"
    });
  }

  summary() {
    const byProtocol = {};
    const byStatus = {};
    for (const record of this.assemblies) {
      byProtocol[record.protocol] = (byProtocol[record.protocol] || 0) + 1;
      byStatus[record.status] = (byStatus[record.status] || 0) + 1;
    }
    return Object.freeze({
      ok: true,
      serviceId: this.serviceId,
      protocolVersion: DOWNSTREAM_CLIENT_ASPECT_PROTOCOL_VERSION,
      serviceKind: DOWNSTREAM_CLIENT_ASPECT_SERVICE_KIND,
      started: this.started,
      frameworkCount: this.frameworks.length,
      layerCount: this.layers.length,
      assemblyCount: this.assemblies.length,
      priorityFrameworks: [...DEFAULT_PRIORITY_FRAMEWORKS],
      byProtocol,
      byStatus,
      routeTargets: { ...DOWNSTREAM_CLIENT_ASPECT_ROUTE_TARGETS },
      layers: this.listProtocolLayers()
    });
  }

  stop() {
    this.started = false;
    return {
      ok: true,
      serviceId: this.serviceId,
      stopped: true
    };
  }
}

export function createDownstreamClientAspectService(options = {}) {
  return new DownstreamClientAspectService(options);
}

export function assembleDownstreamClientAspect(options = {}) {
  const service = createDownstreamClientAspectService(options);
  const summary = service.start(options.start || {});
  return {
    service,
    summary,
    capabilities: service.listCapabilities()
  };
}
