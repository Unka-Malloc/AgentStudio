import { accessSync, constants as fsConstants, existsSync } from "node:fs";
import path from "node:path";

export const DOWNSTREAM_CLIENT_ASPECT_PROTOCOL_VERSION = "pact.downstream-client-aspect.v1";
export const DOWNSTREAM_CLIENT_ASPECT_SERVICE_KIND = "downstream-client-aspect";

export const DOWNSTREAM_CLIENT_ASPECT_ROUTE_TARGETS = Object.freeze({
  mcp: "mcp-server-side",
  acp: "acp-agent-relay"
});

const DEFAULT_PRIORITY_FRAMEWORKS = Object.freeze(["claude-code", "codex", "openclaw"]);

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
    }
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
    }
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
      reasoningVisibilityPolicy: "never"
    }
  },
  {
    frameworkId: "gemini-cli",
    label: "Gemini CLI",
    kind: "cli",
    commandNames: ["gemini"],
    mcp: {
      adapterId: "gemini-cli-mcp-cli",
      profileId: "pact.mcp.gemini-cli",
      installMode: "gemini-release-mcp-cli",
      locations: ["local", "orbstack", "remote-linux"],
      configurationStrategy: "cli-mcp-command"
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
      connectObservationSupported: true
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
    }
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
    }
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
    }
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
    }
  },
  {
    frameworkId: "windsurf",
    label: "Windsurf",
    kind: "desktop-agent",
    commandNames: ["windsurf"],
    mcp: {
      adapterId: "windsurf-mcp-config",
      profileId: "pact.mcp.windsurf",
      installMode: "windsurf-release-mcp-config",
      locations: ["local"],
      configurationStrategy: "desktop-mcp-config"
    }
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

function mergeProtocolConfig(base = {}, override = {}) {
  if (!override || typeof override !== "object") {
    return cloneJson(base || {});
  }
  return {
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
      metadata: asObject(raw.acp.metadata)
    }) : null
  });
}

export function defaultDownstreamClientFrameworks(overrides = []) {
  const byId = defaultFrameworkMap();
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
        toolBoundary: "pact.tool-management.v1",
        mcpInterfaceVersion: "pact.mcp.v1"
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

function acpTransportCommand(acp = {}, commandProbe = {}, { includeEnv = true } = {}) {
  if (acp.command?.executable) {
    return {
      executable: asText(acp.command.executable),
      args: asArray(acp.command.args).map(String),
      ...(includeEnv ? { env: asObject(acp.command.env) } : {}),
      cwd: asText(acp.command.cwd)
    };
  }
  if (commandProbe.found) {
    return {
      executable: commandProbe.path,
      args: [],
      ...(includeEnv ? { env: {} } : {}),
      cwd: ""
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

function acpRelayTargetDescriptor(framework = {}, acp = {}, status = "", command = null) {
  const target = asObject(acp.target);
  const safeMetadata = publicMetadata(acp.metadata);
  const targetId = asText(target.targetId || `${framework.frameworkId}.acp:default`);
  const transport = {
    type: acp.transport,
    ...(acp.protocolStyle ? { protocolStyle: acp.protocolStyle } : {}),
    timeoutMs: Number(target.transport?.timeoutMs || acp.target?.timeoutMs || 0) || 120000
  };
  if (command && acp.transport === "stdio") {
    transport.command = command;
  }
  if (acp.transport === "antigravity-agentapi") {
    transport.connectEnabled = acp.connectObservationSupported === true;
  }
  return {
    targetId,
    label: asText(target.label || `${framework.label} ACP Target`),
    transport,
    agentProfileId: acp.profileId,
    enabled: status === "assembled" && target.enabled !== false,
    disabledReason: status === "assembled" ? "" : status,
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
        ...safeMetadata
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
    const { status, reasonCode } = acpMissingStatus(acp, commandProbe);
    const internalCommand = acpTransportCommand(acp, commandProbe, { includeEnv: true });
    const publicCommand = acpTransportCommand(acp, commandProbe, { includeEnv: false });
    const targetDescriptor = acpRelayTargetDescriptor(framework, acp, status, publicCommand);
    const internalTargetDescriptor = acpRelayTargetDescriptor(framework, acp, status, internalCommand);
    const virtualAgentDescriptor = acpRelayVirtualAgentDescriptor(framework, acp, targetDescriptor);
    const record = {
      ...protocolRecordBase({
        layerId: this.layerId,
        framework,
        protocolConfig: acp,
        sequence: context.sequence || 0,
        assembledAt: context.assembledAt || ""
      }),
      adapterKind: this.adapterKind,
      status,
      reasonCode,
      communication: {
        protocol: "acp",
        direction: "agent-to-agent-through-pact",
        transport: acp.transport,
        targetRole: acp.targetRole
      },
      commandProbe,
      capabilities: {
        configurationStrategy: acp.configurationStrategy,
        installPackage: acp.npxPackage || "",
        modes: [...acp.advertisedModes],
        defaultMode: acp.defaultMode,
        modalities: [...acp.advertisedModalities],
        dataSources: [...acp.advertisedDataSources],
        tools: [...acp.advertisedTools],
        reasoningVisibilityPolicy: acp.reasoningVisibilityPolicy,
        connectObservationSupported: acp.connectObservationSupported === true,
        protocolBoundary: "pact.acp-agent-relay.v1"
      },
      acpRelay: {
        target: targetDescriptor,
        virtualAgent: virtualAgentDescriptor
      },
      metadata: publicMetadata(acp.metadata)
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
    this.frameworks = (frameworks || defaultDownstreamClientFrameworks(frameworkOverrides)).map(normalizeFrameworkDefinition);
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
      operationBoundary: normalizedProtocol === "mcp" ? "pact.tool-management.v1" : "pact.acp-agent-relay.v1"
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
