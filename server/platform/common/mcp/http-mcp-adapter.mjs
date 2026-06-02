import crypto from "node:crypto";
import { sendJson } from "../console/http/http-utils.mjs";
import {
  buildMcpHandshakePayload,
  publicMcpIdentity,
  signMcpHandshake
} from "./identity.mjs";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const DEFAULT_TIMEOUT_MS = 300_000;
export const MCP_INTERFACE_VERSION = "pact.mcp.v1";
export const MCP_TOOLSET_VERSION = "2026-05-25.1";
export const MCP_STABLE_TOOL_NAME = "pact.call";
export const MCP_DISCOVERY_TOOL_NAME = "pact.discovery";
export const MCP_KNOWLEDGE_TOOL_NAME = "pact.knowledge";
export const MCP_SHAREDSPACE_TOOL_NAME = "pact.sharedspace";
export const MCP_CODESPACE_TOOL_NAME = "pact.codespace";
export const MCP_SKILL_HUB_TOOL_NAME = "pact.skillHub";

const CATEGORIZED_TOOL_NAMES = new Set([
  MCP_DISCOVERY_TOOL_NAME,
  MCP_KNOWLEDGE_TOOL_NAME,
  MCP_SHAREDSPACE_TOOL_NAME,
  MCP_CODESPACE_TOOL_NAME,
  MCP_SKILL_HUB_TOOL_NAME
]);

const ACCEPTED_OUTLET_TOOL_NAMES = new Set([
  ...CATEGORIZED_TOOL_NAMES
]);

const activeSseConnections = new Set();

export const MCP_SERVER_NAME = "pact-mcp-server";
export const MCP_SERVER_VERSION = "0.0.1";
export const MCP_CONNECTOR_PACKAGE_NAME = "pact-mcp-connector";
export const MCP_CONNECTOR_VERSION = "0.0.1";
export const MCP_CONNECTOR_GITHUB_REPO = "Unka-Malloc/Pact";
export const PACT_MCP_URL_ENV = "PACT_MCP_URL";
export const PACT_MCP_DISCOVERY_URL_ENV = "PACT_MCP_DISCOVERY_URL";
export const PACT_MCP_DISCOVERY_FILE_ENV = "PACT_MCP_DISCOVERY_FILE";
export const PACT_MCP_DISCOVERY_FILE = "~/.pact/mcp/servers.json";
const MCP_BOOTSTRAP_CURL_FLAGS = "-fL --retry 3 --connect-timeout 20 -sS";
const MCP_BOOTSTRAP_INSTALL_SCRIPT = "pact-mcp-install.sh";
const MCP_BOOTSTRAP_INSTALL_SCRIPT_ZH_CN = "pact-mcp-install.zh-CN.sh";
export const MCP_CLIENT_TARGETS = Object.freeze([
  { target: "codex", label: "Codex", priority: true, installMode: "codex-release-plugin-and-mcp-cli", locations: ["local", "orbstack", "remote-linux"] },
  { target: "claude-code", label: "Claude Code", priority: true, installMode: "claude-code-release-mcp-cli", locations: ["local", "orbstack", "remote-linux"] },
  { target: "gemini-cli", label: "Gemini CLI", priority: false, installMode: "gemini-release-mcp-cli", locations: ["local", "orbstack", "remote-linux"] },
  { target: "kilo-code", label: "Kilo Code", priority: false, installMode: "kilo-release-global-kilo-json", locations: ["local", "orbstack", "remote-linux"] },
  { target: "copilot", label: "Copilot", priority: false, installMode: "copilot-release-mcp-cli", locations: ["local", "orbstack", "remote-linux"] },
  { target: "openclaw", label: "OpenClaw", priority: true, installMode: "openclaw-release-mcp-cli", locations: ["local", "orbstack", "remote-linux"] },
  { target: "hermes", label: "Hermes Agent", priority: false, installMode: "hermes-remote-mcp-cli", locations: ["orbstack", "remote-linux"] },
  { target: "antigravity", label: "Antigravity", priority: false, installMode: "antigravity-release-mcp-config", locations: ["local"] },
  { target: "opencode", label: "OpenCode", priority: true, installMode: "opencode-release-mcp-config", locations: ["local", "orbstack", "remote-linux"] }
]);
export const MCP_PRIORITY_INSTALL_TARGETS = Object.freeze(["claude-code", "codex", "openclaw"]);
const MCP_PRIORITY_INSTALL_TARGET = MCP_PRIORITY_INSTALL_TARGETS.join(",");

function jsonRpcResult(id, result = {}) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function jsonRpcError(id, code, message, data = {}) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message: publicMcpEnvelopeString(message),
      data: publicMcpEnvelopeValue(data)
    }
  };
}

function jsonRpcNotification(method, params = {}) {
  return {
    jsonrpc: "2.0",
    method,
    params
  };
}

function normalizedLocalHost(value) {
  const host = String(value || "").trim().toLowerCase();
  return host === "::1" || host === "[::1]" ? "localhost" : host.split(":")[0];
}

function isAllowedOrigin(request) {
  const origin = String(request?.headers?.origin || "").trim();
  if (!origin) {
    return true;
  }
  try {
    const parsed = new URL(origin);
    const host = normalizedLocalHost(parsed.hostname);
    return new Set(["localhost", "127.0.0.1", "host.orb.internal"]).has(host);
  } catch {
    return false;
  }
}

function normalizeGrantTargets(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 16);
}

function grantMetadata(grant) {
  return grant?.metadata && typeof grant.metadata === "object" && !Array.isArray(grant.metadata)
    ? grant.metadata
    : {};
}

function localMcpGrantTargets(grant) {
  const metadata = grantMetadata(grant);
  return [
    ...normalizeGrantTargets(metadata.targets),
    ...normalizeGrantTargets(metadata.mcpTarget)
  ].filter((target, index, values) => values.indexOf(target) === index);
}

function normalizeGrantValues(value, limit = 64) {
  const items = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, limit);
}

function hasMcpAuthToken(request = null) {
  const authorization = String(request?.headers?.authorization || "").trim();
  return Boolean(
    /^Bearer\s+.+/i.test(authorization) ||
      String(request?.headers?.["x-pact-tool-token"] || "").trim() ||
      String(request?.headers?.["x-pact-api-key"] || "").trim()
  );
}

function randomMcpId(prefix) {
  if (typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
}

function mcpSubjectFromGrant(grant = null) {
  if (!grant) {
    return {
      type: "anonymous",
      subjectId: "",
      label: "",
      scopes: [],
      toolsets: []
    };
  }
  return {
    type: "tool-grant",
    subjectId: String(grant.id || ""),
    label: String(grant.label || grant.id || ""),
    scopes: normalizeGrantValues(grant.scopes || [], 512),
    toolsets: normalizeGrantValues(grant.toolsets || [], 256)
  };
}

function parseRequestBody(requestBody) {
  if (!requestBody || requestBody.length === 0) {
    return {};
  }
  return JSON.parse(requestBody.toString("utf8"));
}

const MCP_OUTLET_METADATA = Object.freeze({
  [MCP_DISCOVERY_TOOL_NAME]: { toolName: MCP_DISCOVERY_TOOL_NAME, architectureCategory: "Discovery" },
  [MCP_KNOWLEDGE_TOOL_NAME]: { toolName: MCP_KNOWLEDGE_TOOL_NAME, architectureCategory: "Knowledge" },
  [MCP_SHAREDSPACE_TOOL_NAME]: { toolName: MCP_SHAREDSPACE_TOOL_NAME, architectureCategory: "Sharedspace" },
  [MCP_CODESPACE_TOOL_NAME]: { toolName: MCP_CODESPACE_TOOL_NAME, architectureCategory: "Codespace" },
  [MCP_SKILL_HUB_TOOL_NAME]: { toolName: MCP_SKILL_HUB_TOOL_NAME, architectureCategory: "Skill Hub" }
});

const MCP_SHAREDSPACE_CORE_OPERATIONS = Object.freeze([
  "pact.agentWorkspace.create",
  "pact.sharedspace.localDir.connect",
  "pact.sharedspace.localDir.list",
  "pact.sharedspace.item.list",
  "pact.sharedspace.file.read",
  "pact.sharedspace.file.write",
  "pact.sharedspace.item.delete",
  "pact.sharedspace.sync.plan",
  "pact.sharedspace.sync.apply"
]);

function sharedspaceExchangeReceiptContract() {
  return {
    schemaVersion: "pact.mcp.sharedspace-exchange.v1",
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
      "operation"
    ],
    fields: [
      "action",
      "outlet",
      "referencePolicy",
      "workspaceRef",
      "path",
      "paths",
      "itemCount",
      "checkpointId",
      "syncReceiptId",
      "nextOperations"
    ]
  };
}

function mcpOutletForTool(tool = {}) {
  const id = String(tool.operationId || tool.id || tool.name || "").trim();
  const publicName = String(tool.id || tool.name || "").trim();
  const feature = String(tool.feature || "").trim();
  const aspects = Array.isArray(tool.aspects) ? tool.aspects.map((item) => String(item || "")) : [];
  const text = `${id} ${publicName} ${feature} ${aspects.join(" ")}`.toLowerCase();

  if (/^(tool_management\.|knowledge\.skills\.|knowledge\.agent_skill\.|workspace\.skill\.|capability_packages\.)/i.test(id)) {
    return MCP_OUTLET_METADATA[MCP_SKILL_HUB_TOOL_NAME];
  }
  if (/^external\.mcp\./i.test(id) || aspects.includes("external-mcp-passthrough") || aspects.includes("skill-hub")) {
    return MCP_OUTLET_METADATA[MCP_SKILL_HUB_TOOL_NAME];
  }
  if (/^(repo\.|gerrit\.|github\.|workspace\.code\.)/i.test(id) || /\b(repo|repository|codespace|gerrit|github)\b/.test(text)) {
    return MCP_OUTLET_METADATA[MCP_CODESPACE_TOOL_NAME];
  }
  if (/^(agent_workspaces\.|agent_sessions\.|sharedspace\.|workspace\.)/i.test(id) || feature === "agent_workspace") {
    return MCP_OUTLET_METADATA[MCP_SHAREDSPACE_TOOL_NAME];
  }
  if (/^knowledge\./i.test(id) || /\b(knowledge|evidence|asset|dossier|distillation)\b/.test(text)) {
    return MCP_OUTLET_METADATA[MCP_KNOWLEDGE_TOOL_NAME];
  }
  return MCP_OUTLET_METADATA[MCP_DISCOVERY_TOOL_NAME];
}

function mcpOutletSummary(operations = []) {
  const outlets = {};
  for (const toolName of CATEGORIZED_TOOL_NAMES) {
    const meta = MCP_OUTLET_METADATA[toolName];
    outlets[toolName] = {
      ...meta,
      ...(toolName === MCP_SHAREDSPACE_TOOL_NAME ? { exchangeReceipt: sharedspaceExchangeReceiptContract() } : {}),
      operationCount: 0,
      operations: []
    };
  }
  for (const operation of operations) {
    const toolName = operation?._meta?.mcpOutlet || MCP_DISCOVERY_TOOL_NAME;
    const outlet = outlets[toolName] || outlets[MCP_DISCOVERY_TOOL_NAME];
    outlet.operationCount += 1;
    outlet.operations.push(operation.name);
  }
  return outlets;
}

function mcpOutletForOperation({ operation = "", toolSkillManagementProvider, authorization = null } = {}) {
  const operationId = String(operation || "").trim();
  if (operationId === "pact.mcp.version" || operationId === "pact.version" || operationId === "pact.capabilities.list") {
    return MCP_OUTLET_METADATA[MCP_DISCOVERY_TOOL_NAME];
  }
  const tools = toolSkillManagementProvider
    .listVisibleTools({ authorization })
    .filter((tool) =>
      tool.id === operationId ||
        tool.operationId === operationId ||
        tool.name === operationId
    );
  if (tools.length === 0) {
    return null;
  }
  return mcpOutletForTool(tools[0]);
}

function operationOutletMismatchError({ id, operation, requestedTool, expectedOutlet }) {
  return {
    httpStatus: 200,
    body: jsonRpcError(id, -32602, `Operation ${operation} must be called through ${expectedOutlet.toolName}, not ${requestedTool}.`, {
      code: "operation_outlet_mismatch",
      operation,
      requestedTool,
      expectedTool: expectedOutlet.toolName,
      architectureCategory: expectedOutlet.architectureCategory,
      discoveryTool: MCP_DISCOVERY_TOOL_NAME,
      discoveryOperation: "pact.capabilities.list",
      stableToolName: MCP_STABLE_TOOL_NAME,
      example: {
        name: expectedOutlet.toolName,
        arguments: {
          apiVersion: MCP_INTERFACE_VERSION,
          operation,
          input: {}
        }
      }
    })
  };
}

function publicMcpTool(tool) {
  const inputSchema = publicMcpInputSchema(tool.inputSchema || { type: "object" });
  const outlet = mcpOutletForTool(tool);
  const workspaceHint = schemaMentionsWorkspaceId(tool.inputSchema)
    ? " MCP clients should use workspaceRef, workspaceIndex, or workspaceName instead of internal workspaceId."
    : "";
  const scopeHint = (tool.requiredScopes || []).length > 0
    ? ` Requires scope: ${tool.requiredScopes.join(", ")}.`
    : "";
  const riskHint = tool.risk && tool.risk !== "read_only"
    ? ` Risk: ${tool.risk}.`
    : "";
  return {
    name: tool.id,
    title: tool.label || tool.id,
    description: `${tool.description || tool.label || tool.id}${scopeHint}${riskHint}${workspaceHint}`,
    inputSchema,
    annotations: {
      readOnlyHint: tool.readOnly !== false,
      destructiveHint: tool.destructive === true
    },
    _meta: {
      operationId: tool.operationId || tool.id,
      mcpOutlet: outlet.toolName,
      architectureCategory: outlet.architectureCategory,
      ...(outlet.toolName === MCP_SHAREDSPACE_TOOL_NAME ? { exchangeReceipt: sharedspaceExchangeReceiptContract() } : {}),
      toolsets: tool.toolsets || [],
      requiredScopes: tool.requiredScopes || [],
      risk: tool.risk || "read_only"
    }
  };
}

function schemaMentionsWorkspaceId(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(schemaMentionsWorkspaceId);
  }
  return Object.entries(value).some(([key, child]) =>
    /workspaceId$/i.test(key) || schemaMentionsWorkspaceId(child)
  );
}

function publicMcpInputSchema(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(publicMcpInputSchema);
  }
  const next = { ...value };
  if (Array.isArray(next.required)) {
    next.required = next.required.filter((item) => !/workspaceId$/i.test(String(item || "")));
  }
  if (next.properties && typeof next.properties === "object" && !Array.isArray(next.properties)) {
    const properties = {};
    for (const [key, child] of Object.entries(next.properties)) {
      if (/workspaceId$/i.test(key)) {
        const refKey = key.replace(/Id$/i, "Ref");
        properties[refKey] = {
          type: "string",
          description: "Public Pact MCP workspace reference, for example 'workspace-1'. Discover it with operation 'pact.agentWorkspace.list'."
        };
        if (key === "workspaceId") {
          properties.workspaceIndex = {
            type: "integer",
            description: "Public Pact MCP workspace index from operation 'pact.agentWorkspace.list', for example 1."
          };
          properties["workspace-index"] = {
            type: "integer",
            description: "Alias for workspaceIndex. Public Pact MCP workspace index from operation 'pact.agentWorkspace.list', for example 1."
          };
          properties.workspaceName = {
            type: "string",
            description: "Workspace title/name from operation 'pact.agentWorkspace.list'."
          };
          properties["workspace-name"] = {
            type: "string",
            description: "Alias for workspaceName. Workspace title/name from operation 'pact.agentWorkspace.list'."
          };
        }
        continue;
      }
      properties[key] = publicMcpInputSchema(child);
    }
    next.properties = properties;
  }
  for (const key of ["items", "oneOf", "anyOf", "allOf"]) {
    if (next[key]) {
      next[key] = publicMcpInputSchema(next[key]);
    }
  }
  return next;
}

function executeToolPayload(result = {}) {
  return result.payload?.result !== undefined ? result.payload.result : result.payload;
}

function pactCategorizedTools() {
  const commonSchema = {
    type: "object",
    additionalProperties: false,
    required: ["operation"],
    properties: {
      apiVersion: {
        type: "string",
        description: "Pact MCP interface version expected by the caller.",
        default: MCP_INTERFACE_VERSION,
        enum: [MCP_INTERFACE_VERSION]
      },
      operation: {
        type: "string",
        description: "Concrete Pact operation id to execute, for example 'pact.knowledge.health'. Do not use an outlet tool name itself here, such as 'pact.discovery' or 'pact.knowledge'. If unsure, first call tool 'pact.discovery' with operation 'pact.capabilities.list' and then use one returned operations[].name value."
      },
      input: {
        type: "object",
        description: "Operation input payload.",
        additionalProperties: true,
        default: {}
      },
      subject: {
        type: "object",
        description: "Optional caller subject. If omitted, Pact injects the authenticated grant subject.",
        additionalProperties: true
      },
      operatorId: {
        type: "string",
        description: "External agent or operator id that initiated this intent."
      },
      agentProfileId: {
        type: "string",
        description: "Agent profile id used for policy, audit, and reply routing."
      },
      workspaceId: {
        type: "string",
        description: "Workspace id or public workspace reference targeted by this intent."
      },
      traceId: {
        type: "string",
        description: "Caller trace id. Pact generates one when omitted."
      },
      idempotencyKey: {
        type: "string",
        description: "Caller idempotency key. Pact generates one when omitted."
      },
      intent: {
        type: "string",
        description: "Human or agent intent label for audit and asynchronous replies."
      },
      dryRun: {
        type: "boolean",
        description: "Preview policy and execution effects without mutating state.",
        default: false
      },
      requestedScopes: {
        type: "array",
        description: "Optional scopes the caller believes are needed for this operation.",
        items: { type: "string" },
        default: []
      },
      clientVersion: {
        type: "string",
        description: "Optional client-side integration version for diagnostics."
      }
    }
  };

  const toolMeta = {
    interfaceVersion: MCP_INTERFACE_VERSION,
    toolsetVersion: MCP_TOOLSET_VERSION,
    stableTool: true,
    upgradeNotification: "notifications/tools/list_changed"
  };

  return [
    {
      name: MCP_DISCOVERY_TOOL_NAME,
      title: "Pact Discovery",
      description: "Discovery outlet/router for capability discovery, tool descriptions, doctor checks, available commands, and connection state. Start here with operation='pact.capabilities.list', then use one returned operations[].name as the operation value for a Pact outlet.",
      inputSchema: commonSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: {
        ...toolMeta,
        architectureCategory: "Discovery"
      }
    },
    {
      name: MCP_KNOWLEDGE_TOOL_NAME,
      title: "Pact Knowledge",
      description: "AgentLibrary-governed Knowledge outlet/router for search, evidence, asset, and export operations. Do not call operation='pact.knowledge'. First discover concrete operation ids by calling tool 'pact.discovery' with operation='pact.capabilities.list'.",
      inputSchema: commonSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: {
        ...toolMeta,
        architectureCategory: "Knowledge"
      }
    },
    {
      name: MCP_SHAREDSPACE_TOOL_NAME,
      title: "Pact Sharedspace",
      description: "Sharedspace outlet/router for context, files, artifacts, proposals, and shared workspace state governed by StateCommit-compatible operation ledger and checkpoint semantics. Do not call operation='pact.sharedspace'. First discover concrete operation ids by calling tool 'pact.discovery' with operation='pact.capabilities.list'.",
      inputSchema: commonSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: {
        ...toolMeta,
        architectureCategory: "Sharedspace"
      }
    },
    {
      name: MCP_CODESPACE_TOOL_NAME,
      title: "Pact Codespace",
      description: "Codespace outlet/router for code spaces, repository state, diffs, commits, and GitHub/Gerrit provider operations. Do not call operation='pact.codespace'. First discover concrete operation ids by calling tool 'pact.discovery' with operation='pact.capabilities.list'.",
      inputSchema: commonSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: {
        ...toolMeta,
        architectureCategory: "Codespace"
      }
    },
    {
      name: MCP_SKILL_HUB_TOOL_NAME,
      title: "Pact Skill Hub",
      description: "Skill Hub outlet/router for skills, tools, toolsets, grants, risk, policy, and audit operations. Do not call operation='pact.skillHub'. First discover concrete operation ids by calling tool 'pact.discovery' with operation='pact.capabilities.list'.",
      inputSchema: commonSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: {
        ...toolMeta,
        architectureCategory: "Skill Hub"
      }
    }
  ];
}

function mcpVersionInfo() {
  return {
    interfaceVersion: MCP_INTERFACE_VERSION,
    toolsetVersion: MCP_TOOLSET_VERSION,
    serverVersion: MCP_SERVER_VERSION,
    stableToolName: MCP_STABLE_TOOL_NAME,
    categorizedOutlets: Array.from(CATEGORIZED_TOOL_NAMES),
    capabilitiesSummary: "Pact MCP Plugin capability layer. Outlets: Discovery, Knowledge, Sharedspace, Codespace, and Skill Hub.",
    listChanged: true,
    upgradeNotification: "notifications/tools/list_changed",
    connector: {
      packageName: MCP_CONNECTOR_PACKAGE_NAME,
      packageVersion: MCP_CONNECTOR_VERSION
    }
  };
}

function mcpConnectorRuntimeMetadata(discovery, version = mcpVersionInfo()) {
  return {
    ...version.connector,
    githubOneLineCommand: discovery.installer.githubOneLineCommand,
    githubOneLineCommandZhCN: discovery.installer.githubOneLineCommandZhCN,
    clientInstallCommand: discovery.installer.clientInstallCommand,
    clientInstallJsonCommand: discovery.installer.clientInstallJsonCommand,
    autoInstallCommand: discovery.installer.autoInstallCommand,
    priorityInstallCommand: discovery.installer.priorityInstallCommand,
    githubOneLineInstallCommand: discovery.installer.githubOneLineInstallCommand,
    githubOneLineInstallCommandZhCN: discovery.installer.githubOneLineInstallCommandZhCN,
    githubOneLineClientInstallJsonCommand: discovery.installer.githubOneLineClientInstallJsonCommand,
    githubOneLineClientInstallJsonCommandZhCN: discovery.installer.githubOneLineClientInstallJsonCommandZhCN,
    githubOneLineAutoInstallCommand: discovery.installer.githubOneLineAutoInstallCommand,
    githubOneLineAutoInstallCommandZhCN: discovery.installer.githubOneLineAutoInstallCommandZhCN,
    githubOneLinePriorityInstallCommand: discovery.installer.githubOneLinePriorityInstallCommand,
    githubOneLinePriorityInstallCommandZhCN: discovery.installer.githubOneLinePriorityInstallCommandZhCN,
    oneCommandInstall: discovery.installer.oneCommandInstall,
    oneCommandInstallZhCN: discovery.installer.oneCommandInstallZhCN,
    oneCommandClientInstallJson: discovery.installer.oneCommandClientInstallJson,
    oneCommandClientInstallJsonZhCN: discovery.installer.oneCommandClientInstallJsonZhCN,
    oneCommandAutoInstall: discovery.installer.oneCommandAutoInstall,
    oneCommandAutoInstallZhCN: discovery.installer.oneCommandAutoInstallZhCN,
    oneCommandPriorityInstall: discovery.installer.oneCommandPriorityInstall,
    oneCommandPriorityInstallZhCN: discovery.installer.oneCommandPriorityInstallZhCN,
    discoverCommand: discovery.installer.discoverCommand,
    scanCommand: discovery.installer.scanCommand,
    doctorCommand: discovery.installer.doctorCommand,
    portableAutoInstallCommand: discovery.installer.portable.autoInstallCommand,
    portablePriorityInstallCommand: discovery.installer.portable.priorityInstallCommand,
    portableClientInstallJsonCommand: discovery.installer.portable.clientInstallJsonCommand
  };
}

function mcpRuntimeMetadata({ listenUrl = "", discoveryState = null } = {}) {
  const discovery = buildPactMcpDiscovery({ listenUrl, discoveryState });
  const version = mcpVersionInfo();
  return {
    ...version,
    connector: mcpConnectorRuntimeMetadata(discovery, version),
    sharedHub: discovery.sharedHub,
    priorityTargets: [...MCP_PRIORITY_INSTALL_TARGETS],
    supportedTargets: mcpSupportedTargetDetails()
  };
}

function mcpAuthorizationErrorData({ authorization = {}, listenUrl = "", discoveryState = null } = {}) {
  const discovery = buildPactMcpDiscovery({ listenUrl, discoveryState });
  const connector = mcpConnectorRuntimeMetadata(discovery);
  const nextCommand = connector.oneCommandAutoInstall || connector.autoInstallCommand;
  const nextCommandZhCN = connector.oneCommandAutoInstallZhCN || connector.githubOneLineAutoInstallCommandZhCN;
  return {
    code: authorization.reasonCode || "authorization_denied",
    stableToolName: MCP_STABLE_TOOL_NAME,
    connector,
    localGrantEndpoint: discovery.installer.localGrantEndpoint,
    priorityTargets: [...MCP_PRIORITY_INSTALL_TARGETS],
    supportedTargets: mcpSupportedTargetDetails(),
    nextCommand,
    nextCommandZhCN,
    repairCommands: [
      nextCommand,
      nextCommandZhCN,
      connector.oneCommandPriorityInstall,
      connector.oneCommandPriorityInstallZhCN,
      connector.autoInstallCommand,
      connector.priorityInstallCommand,
      connector.doctorCommand
    ].filter(Boolean).filter((command, index, commands) => commands.indexOf(command) === index)
  };
}

function mcpDiscoveryBase({ listenUrl = "", discoveryState = null } = {}) {
  const baseUrl = String(discoveryState?.activeServiceUrl || listenUrl || "").replace(/\/+$/, "");
  let vmBaseUrl = "";
  try {
    const parsed = new URL(baseUrl);
    vmBaseUrl = `${parsed.protocol}//host.orb.internal:${parsed.port || (parsed.protocol === "https:" ? "443" : "80")}`;
  } catch {
    // Keep the conservative default.
  }
  return { baseUrl, vmBaseUrl };
}

function shellQuote(value) {
  return `'${String(value || "").replace(/'/g, "'\\''")}'`;
}

function commandUrlArgs(baseUrl) {
  const text = String(baseUrl || "").trim();
  return text ? ` --url ${shellQuote(text)}` : "";
}

function githubOneLineMcpInstallCommand(scriptName = MCP_BOOTSTRAP_INSTALL_SCRIPT) {
  return `/bin/sh -c "$(curl ${MCP_BOOTSTRAP_CURL_FLAGS} https://github.com/${MCP_CONNECTOR_GITHUB_REPO}/releases/latest/download/${scriptName})"`;
}

function githubOneLineMcpInstallCommands({ baseUrl = "" } = {}) {
  const urlArgs = commandUrlArgs(baseUrl);
  const command = githubOneLineMcpInstallCommand();
  const commandZhCN = githubOneLineMcpInstallCommand(MCP_BOOTSTRAP_INSTALL_SCRIPT_ZH_CN);
  const build = (oneLineCommand) => ({
    installCommand: urlArgs ? `${oneLineCommand} --${urlArgs}` : oneLineCommand,
    clientInstallJsonCommand: `${oneLineCommand} -- --target <client>${urlArgs} --json`,
    autoInstallCommand: `${oneLineCommand} -- --target auto${urlArgs} --json`,
    priorityInstallCommand: `${oneLineCommand} -- --target ${MCP_PRIORITY_INSTALL_TARGET}${urlArgs} --json`
  });
  const english = build(command);
  const zhCN = build(commandZhCN);
  return {
    command,
    ...english,
    commandZhCN,
    installCommandZhCN: zhCN.installCommand,
    clientInstallJsonCommandZhCN: zhCN.clientInstallJsonCommand,
    autoInstallCommandZhCN: zhCN.autoInstallCommand,
    priorityInstallCommandZhCN: zhCN.priorityInstallCommand
  };
}

function mcpTargetConfigTemplate(target, { baseUrl = "", vmBaseUrl = "" } = {}) {
  const mcpUrl = `${baseUrl}/mcp`;
  const vmMcpUrl = `${vmBaseUrl}/mcp`;
  const headerConfig = {
    "X-Pact-Api-Key": "${PACT_MCP_TOKEN}"
  };
  if (target === "codex") {
    return {
      mcp_servers: {
        pact: {
          url: mcpUrl,
          bearer_token_env_var: "PACT_MCP_TOKEN"
        }
      }
    };
  }
  if (target === "claude-code") {
    return {
      type: "http",
      url: mcpUrl,
      vmUrl: vmMcpUrl,
      headers: headerConfig
    };
  }
  if (target === "opencode") {
    return {
      mcp: {
        pact: {
          type: "remote",
          url: mcpUrl,
          vmUrl: vmMcpUrl,
          headers: headerConfig,
          enabled: true
        }
      }
    };
  }
  if (target === "openclaw") {
    return {
      type: "http",
      url: mcpUrl,
      vmUrl: vmMcpUrl,
      headers: headerConfig,
      timeout: DEFAULT_TIMEOUT_MS,
      enabled: true
    };
  }
  if (target === "antigravity") {
    return {
      mcpServers: {
        pact: {
          serverUrl: mcpUrl,
          headers: headerConfig,
          disabled: false
        }
      }
    };
  }
  return {
    type: "http",
    url: mcpUrl,
    vmUrl: vmMcpUrl,
    headers: headerConfig,
    timeout: DEFAULT_TIMEOUT_MS
  };
}

function mcpClientTargetGuides({ baseUrl = "", vmBaseUrl = "", githubOneLineCommand = "", githubOneLineCommandZhCN = "" } = {}) {
  const urlArgs = commandUrlArgs(baseUrl);
  return MCP_CLIENT_TARGETS.map((client) => ({
    ...client,
    endpoints: {
      mcpUrl: `${baseUrl}/mcp`,
      vmMcpUrl: `${vmBaseUrl}/mcp`
    },
    install: {
      oneCommand: `${githubOneLineCommand} -- --target ${client.target}${urlArgs}`,
      oneCommandJson: `${githubOneLineCommand} -- --target ${client.target}${urlArgs} --json`,
      oneCommandZhCN: `${githubOneLineCommandZhCN} -- --target ${client.target}${urlArgs}`,
      oneCommandJsonZhCN: `${githubOneLineCommandZhCN} -- --target ${client.target}${urlArgs} --json`,
      npx: `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest install --target ${client.target}${urlArgs}`,
      npxJson: `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest install --target ${client.target}${urlArgs} --json`,
      portable: `./pact-mcp install --target ${client.target}${urlArgs}`,
      portableJson: `./pact-mcp install --target ${client.target}${urlArgs} --json`,
      uninstall: `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest uninstall --target ${client.target}${urlArgs}`,
      doctor: `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest doctor${urlArgs} --json`
    },
    tokenInput: "auto-local-grant-or-stdin-or-env",
    configTemplate: mcpTargetConfigTemplate(client.target, { baseUrl, vmBaseUrl })
  }));
}

function mcpSupportedTargetDetails() {
  return MCP_CLIENT_TARGETS.map(({ target, label, priority, installMode, locations }) => ({
    target,
    label,
    priority,
    installMode,
    locations: [...locations]
  }));
}

export function buildPactMcpDiscovery({ listenUrl = "", discoveryState = null } = {}) {
  const { baseUrl, vmBaseUrl } = mcpDiscoveryBase({ listenUrl, discoveryState });
  const urlArgs = commandUrlArgs(baseUrl);
  const installCommand = `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest register${urlArgs}`;
  const clientInstallCommand = `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest install --target <client>${urlArgs}`;
  const clientInstallJsonCommand = `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest install --target <client>${urlArgs} --json`;
  const autoInstallCommand = `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest install --target auto${urlArgs} --json`;
  const priorityInstallCommand = `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest install --target ${MCP_PRIORITY_INSTALL_TARGET}${urlArgs} --json`;
  const interactiveInstallCommand = `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest install${urlArgs}`;
  const {
    command: githubOneLineCommand,
    commandZhCN: githubOneLineCommandZhCN,
    installCommand: githubOneLineInstallCommand,
    installCommandZhCN: githubOneLineInstallCommandZhCN,
    clientInstallJsonCommand: githubOneLineClientInstallJsonCommand,
    clientInstallJsonCommandZhCN: githubOneLineClientInstallJsonCommandZhCN,
    autoInstallCommand: githubOneLineAutoInstallCommand,
    autoInstallCommandZhCN: githubOneLineAutoInstallCommandZhCN,
    priorityInstallCommand: githubOneLinePriorityInstallCommand,
    priorityInstallCommandZhCN: githubOneLinePriorityInstallCommandZhCN
  } = githubOneLineMcpInstallCommands({ baseUrl });
  const uninstallCommand = `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest uninstall --target <client>${urlArgs}`;
  const doctorCommand = `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest doctor${urlArgs}`;
  const discoverCommand = `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest discover-local${urlArgs} --json`;
  const scanCommand = `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest scan${urlArgs} --json`;
  const clientTargets = mcpClientTargetGuides({ baseUrl, vmBaseUrl, githubOneLineCommand, githubOneLineCommandZhCN });
  const supportedTargets = mcpSupportedTargetDetails();
  return {
    schemaVersion: 1,
    name: "Pact",
    description: "Pact MCP Plugin capability layer. Provides five architecture outlets for Discovery, Knowledge, Sharedspace, Codespace, and Skill Hub.",
    interfaceVersion: MCP_INTERFACE_VERSION,
    toolsetVersion: MCP_TOOLSET_VERSION,
    serverVersion: MCP_SERVER_VERSION,
    serverId: discoveryState?.serverId || "",
    stableToolName: MCP_STABLE_TOOL_NAME,
    sharedHub: {
      canonicalMcpUrl: `${baseUrl}/mcp`,
      vmMcpUrl: `${vmBaseUrl}/mcp`,
      clientPolicy: "discover-shared-hub-then-opt-in",
      defaultClientMutation: "none",
      directHttp: true,
      sharedspace: {
        outlet: MCP_SHAREDSPACE_TOOL_NAME,
        referencePolicy: "use-public-workspace-ref",
        exchangeReceipt: sharedspaceExchangeReceiptContract(),
        coreOperations: [...MCP_SHAREDSPACE_CORE_OPERATIONS]
      }
    },
    localDiscovery: {
      entrypoint: {
        command: discoverCommand,
        registryFile: PACT_MCP_DISCOVERY_FILE,
        schemaVersion: "pact.mcp.device-hub.v1"
      },
      env: {
        [PACT_MCP_URL_ENV]: `${baseUrl}/mcp`,
        [PACT_MCP_DISCOVERY_URL_ENV]: `${baseUrl}/.well-known/pact/mcp.json`,
        [PACT_MCP_DISCOVERY_FILE_ENV]: PACT_MCP_DISCOVERY_FILE
      },
      files: [
        PACT_MCP_DISCOVERY_FILE
      ],
      http: [
        `${baseUrl}/.well-known/pact/mcp.json`,
        `${baseUrl}/api/mcp/discovery`
      ],
      lookupOrder: [
        "pact-mcp discover-local --json",
        "PACT_MCP_URL",
        "PACT_MCP_DISCOVERY_URL",
        "PACT_MCP_DISCOVERY_FILE",
        "signed local port scan"
      ]
    },
    installer: {
      packageName: MCP_CONNECTOR_PACKAGE_NAME,
      packageVersion: MCP_CONNECTOR_VERSION,
      releaseChannel: "stable",
      supportedTargets,
      priorityTargets: [...MCP_PRIORITY_INSTALL_TARGETS],
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
      installCommand,
      interactiveInstallCommand,
      autoInstallCommand,
      priorityInstallCommand,
      clientInstallCommand,
      clientInstallJsonCommand,
      uninstallCommand,
      doctorCommand,
      discoverCommand,
      scanCommand,
      tokenInput: "auto-local-grant-or-stdin-or-env",
      localGrantEndpoint: `${baseUrl}/api/mcp/local-grant`,
      npmExec: `npx ${MCP_CONNECTOR_PACKAGE_NAME}@latest`,
      portable: {
        requiresInstalledNode: false,
        strategy: "embedded-node-runtime",
        preferredArchive: "zip",
        bootstrapScript: MCP_BOOTSTRAP_INSTALL_SCRIPT,
        bootstrapScriptZhCN: MCP_BOOTSTRAP_INSTALL_SCRIPT_ZH_CN,
        githubLatestBootstrapUrl: `https://github.com/${MCP_CONNECTOR_GITHUB_REPO}/releases/latest/download/${MCP_BOOTSTRAP_INSTALL_SCRIPT}`,
        githubLatestBootstrapUrlZhCN: `https://github.com/${MCP_CONNECTOR_GITHUB_REPO}/releases/latest/download/${MCP_BOOTSTRAP_INSTALL_SCRIPT_ZH_CN}`,
        githubOneLineCommand,
        githubOneLineCommandZhCN,
        githubOneLineAutoInstallCommand,
        githubOneLineAutoInstallCommandZhCN,
        githubOneLinePriorityInstallCommand,
        githubOneLinePriorityInstallCommandZhCN,
        supportsMultiSelect: true,
        releaseAssetPattern: `${MCP_CONNECTOR_PACKAGE_NAME}-${MCP_CONNECTOR_VERSION}-<platform>.zip`,
        tarballReleaseAssetPattern: `${MCP_CONNECTOR_PACKAGE_NAME}-${MCP_CONNECTOR_VERSION}-<platform>.tar.gz`,
        zipInstallEntry: "install.command",
        installCommand: `./pact-mcp register${urlArgs}`,
        interactiveInstallCommand: `./pact-mcp install${urlArgs}`,
        autoInstallCommand: `./pact-mcp install --target auto${urlArgs} --json`,
        priorityInstallCommand: `./pact-mcp install --target ${MCP_PRIORITY_INSTALL_TARGET}${urlArgs} --json`,
        priorityTargets: [...MCP_PRIORITY_INSTALL_TARGETS],
        clientInstallCommand: `./pact-mcp install --target <client>${urlArgs}`,
        clientInstallJsonCommand: `./pact-mcp install --target <client>${urlArgs} --json`,
        doubleClickEntry: "install.command"
      }
    },
    clientTargets,
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
      priorityTargets: [...MCP_PRIORITY_INSTALL_TARGETS],
      doctorCommand
    },
    mcpServers: {
      pact: {
        httpUrl: `${baseUrl}/mcp`,
        vmHttpUrl: `${vmBaseUrl}/mcp`,
        headers: {
          "X-Pact-Api-Key": "${PACT_MCP_TOKEN}"
        },
        authProviderType: "pact_api_key",
        timeout: DEFAULT_TIMEOUT_MS
      }
    },
    codex: {
      mcp_servers: {
        pact: {
          url: `${baseUrl}/mcp`,
          bearer_token_env_var: "PACT_MCP_TOKEN"
        }
      }
    },
    geminiCli: {
      mcpServers: {
        pact: {
          url: `${baseUrl}/mcp`,
          type: "http",
          headers: {
            "X-Pact-Api-Key": "${PACT_MCP_TOKEN}"
          },
          timeout: DEFAULT_TIMEOUT_MS,
          trust: true
        }
      }
    },
    geminiExtension: {
      mcpServers: {
        pact: {
          httpUrl: `${baseUrl}/mcp`,
          headers: {
            "X-Pact-Api-Key": "${PACT_MCP_TOKEN}"
          },
          timeout: DEFAULT_TIMEOUT_MS
        }
      }
    },
    auth: {
      type: "pact_tool_management_token",
      acceptedHeaders: ["Authorization: Bearer <token>", "X-Pact-Api-Key"],
      tokenSource: "Pact Tool Management grant token"
    },
    identity: discoveryState?.mcpIdentity
      ? publicMcpIdentity(discoveryState.mcpIdentity)
      : null,
    handshake: {
      schemaVersion: "pact.mcp.handshake.v1",
      method: "POST",
      url: `${baseUrl}/api/mcp/handshake`,
      nonceBytes: 32,
      signatureAlgorithm: "Ed25519",
      signaturePayloadEncoding: "pact.stable-json.v1"
    }
  };
}

function validHandshakeNonce(value) {
  return /^[A-Za-z0-9_-]{24,256}$/.test(String(value || ""));
}

function mcpHandshake({ requestBody, listenUrl = "", discoveryState = null }) {
  const identity = discoveryState?.mcpIdentity;
  if (!identity) {
    return {
      ok: false,
      status: 503,
      body: {
        ok: false,
        error: "Pact MCP identity is not available."
      }
    };
  }
  const body = parseRequestBody(requestBody);
  const nonce = String(body?.nonce || "").trim();
  if (!validHandshakeNonce(nonce)) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        error: "MCP handshake requires a base64url nonce with at least 24 characters."
      }
    };
  }
  const { baseUrl, vmBaseUrl } = mcpDiscoveryBase({ listenUrl, discoveryState });
  const discovery = buildPactMcpDiscovery({ listenUrl, discoveryState });
  const issuedAt = new Date().toISOString();
  const payload = buildMcpHandshakePayload({
    nonce,
    issuedAt,
    identity,
    discovery,
    baseUrl,
    vmBaseUrl
  });
  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      payload,
      signature: signMcpHandshake({ identity, payload })
    }
  };
}

function mcpInitializeResult({ listenUrl = "", discoveryState = null } = {}) {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {
      tools: {
        listChanged: true
      }
    },
    serverInfo: {
      name: "Pact",
      version: MCP_SERVER_VERSION
    },
    _meta: mcpRuntimeMetadata({ listenUrl, discoveryState })
  };
}

function mcpToolResult(payload) {
  const structuredContent = payload?.result !== undefined ? payload.result : payload;
  return {
    content: payload?.content || [
      {
        type: "text",
        text: JSON.stringify(structuredContent ?? {}, null, 2)
      }
    ],
    structuredContent
  };
}

function normalizeMcpSubject(value, authorization) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      ...mcpSubjectFromGrant(authorization?.grant || null),
      ...value
    };
  }
  return mcpSubjectFromGrant(authorization?.grant || null);
}

function normalizeMcpOperationEnvelope(input, authorization) {
  const payload = input && typeof input === "object" ? input : {};
  const apiVersion = String(payload.apiVersion || MCP_INTERFACE_VERSION).trim();
  if (apiVersion !== MCP_INTERFACE_VERSION) {
    return {
      ok: false,
      error: jsonRpcError(null, -32602, `Unsupported Pact MCP apiVersion: ${apiVersion}`, {
        expectedApiVersion: MCP_INTERFACE_VERSION,
        toolsetVersion: MCP_TOOLSET_VERSION,
        upgrade: mcpVersionInfo()
      })
    };
  }
  const operation = String(payload.operation || "").trim();
  if (!operation) {
    return {
      ok: false,
      error: jsonRpcError(null, -32602, "pact.call requires arguments.operation.", {
        expectedApiVersion: MCP_INTERFACE_VERSION
      })
    };
  }
  const grant = authorization?.grant || null;
  const metadata = grantMetadata(grant);
  const operationInput = payload.input && typeof payload.input === "object" && !Array.isArray(payload.input)
    ? payload.input
    : {};
  const workspaceId = String(
    payload.workspaceId ||
      operationInput.workspaceId ||
      operationInput.workspaceRef ||
      operationInput["workspace-ref"] ||
      ""
  ).trim();
  const agentProfileId = String(
    payload.agentProfileId ||
      payload.agent_profile_id ||
      metadata.agentProfileId ||
      metadata.agentProfile ||
      ""
  ).trim();
  const targets = localMcpGrantTargets(grant);
  const operatorId = String(
    payload.operatorId ||
      payload.operator_id ||
      metadata.operatorId ||
      metadata.operator ||
      targets[0] ||
      grant?.id ||
      "mcp-agent"
  ).trim();
  const traceId = String(payload.traceId || payload.trace_id || requestTraceIdFromAuthorization(authorization) || randomMcpId("mcp_trace")).trim();
  const idempotencyKey = String(payload.idempotencyKey || payload.idempotency_key || randomMcpId("mcp_intent")).trim();
  const envelope = {
    apiVersion,
    operation,
    intent: String(payload.intent || operation).trim(),
    input: operationInput,
    subject: normalizeMcpSubject(payload.subject, authorization),
    operatorId,
    agentProfileId,
    workspaceId,
    traceId,
    idempotencyKey,
    dryRun: payload.dryRun === true,
    requestedScopes: normalizeGrantValues(payload.requestedScopes || payload.requested_scopes || [], 128),
    clientVersion: String(payload.clientVersion || "").trim()
  };
  return {
    ok: true,
    operation,
    input: operationInput,
    envelope
  };
}

function requestTraceIdFromAuthorization(authorization = null) {
  return String(authorization?.traceId || authorization?.authorizationDecision?.traceId || "").trim();
}

function isInternalMcpAbsolutePath(value) {
  const text = String(value || "");
  return (
    /^\/(?:Users|home|root|private|var|tmp|opt|usr|Volumes)\//.test(text) ||
    /^[A-Za-z]:[\\/]/.test(text)
  );
}

function publicMcpWorkspaceToken(workspaceDirectory = null, workspaceId = "") {
  const entry = workspaceDirectory?.byId?.get?.(String(workspaceId || ""));
  return entry?.ref || "workspace-hidden";
}

function publicMcpEnvelopeString(value, workspaceDirectory = null) {
  const text = String(value || "");
  if (!text) {
    return "";
  }
  if (isInternalMcpAbsolutePath(text)) {
    return "[server-internal-path]";
  }
  return text
    .replace(/\bworkspace_[A-Za-z0-9_]+\b/g, (workspaceId) => publicMcpWorkspaceToken(workspaceDirectory, workspaceId))
    .replace(/(^|[\s"'=:(])((?:\/(?:Users|home|root|private|var|tmp|opt|usr|Volumes)\/)[^\s"',)\]}]+)/g, "$1[server-internal-path]")
    .replace(/(^|[\s"'=:(])([A-Za-z]:[\\/][^\s"',)\]}]+)/g, "$1[server-internal-path]")
    .replace(/\b(Authorization\s*:\s*Bearer\s+)[^\s"',;)\]}]+/gi, "$1<redacted-token>")
    .replace(/\b(X-Pact-Api-Key\s*:\s*)[^\s"',;)\]}]+/gi, "$1<redacted-token>")
    .replace(/\b(x-pact-tool-token\s*:\s*)[^\s"',;)\]}]+/gi, "$1<redacted-token>")
    .replace(/(^|[\s"'=:(])(--token(?:=|\s+))[^\s"',;)\]}]+/gi, "$1$2<redacted-token>")
    .replace(/\b(token|access_token|refresh_token|api_key|apiKey|secret|password)=([^\s"',;)\]}]+)/gi, "$1=<redacted-secret>");
}

function publicMcpEnvelopeValue(value, workspaceDirectory = null, depth = 0) {
  if (Array.isArray(value)) {
    return value.slice(0, 128).map((item) => publicMcpEnvelopeValue(item, workspaceDirectory, depth + 1));
  }
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? publicMcpEnvelopeString(value, workspaceDirectory) : value;
  }
  if (depth > 5) {
    return { type: "object", keys: Object.keys(value).slice(0, 40).map((key) => publicMcpEnvelopeString(key, workspaceDirectory)) };
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !isSensitiveMcpEnvelopeKey(key))
    .map(([key, child]) => [
      publicMcpEnvelopeString(key, workspaceDirectory),
      publicMcpEnvelopeValue(child, workspaceDirectory, depth + 1)
    ]));
}

function isSensitiveMcpEnvelopeKey(key = "") {
  const normalized = String(key || "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  if (normalized === "secretref" || normalized === "endpointref") {
    return false;
  }
  return [
    "authorization",
    "bearertoken",
    "cookie",
    "setcookie",
    "token",
    "tokenprefix",
    "accesstoken",
    "refreshtoken",
    "idtoken",
    "apikey",
    "xpactapikey",
    "xpacttooltoken",
    "secret",
    "clientsecret",
    "password",
    "privatekey",
    "privatekeyjwk"
  ].includes(normalized);
}

function mcpEnvelopePublic(envelope = {}, workspaceDirectory = null) {
  return {
    apiVersion: envelope.apiVersion || MCP_INTERFACE_VERSION,
    operation: envelope.operation || "",
    intent: publicMcpEnvelopeString(envelope.intent || envelope.operation || "", workspaceDirectory),
    traceId: publicMcpEnvelopeString(envelope.traceId || "", workspaceDirectory),
    idempotencyKey: publicMcpEnvelopeString(envelope.idempotencyKey || "", workspaceDirectory),
    operatorId: publicMcpEnvelopeString(envelope.operatorId || "", workspaceDirectory),
    agentProfileId: publicMcpEnvelopeString(envelope.agentProfileId || "", workspaceDirectory),
    workspaceId: publicMcpEnvelopeString(envelope.workspaceId || "", workspaceDirectory),
    requestedScopes: publicMcpEnvelopeValue(envelope.requestedScopes || [], workspaceDirectory),
    dryRun: envelope.dryRun === true,
    subject: publicMcpEnvelopeValue(envelope.subject || {}, workspaceDirectory)
  };
}

async function pactMetaResult({
  operation,
  input,
  envelope,
  toolSkillManagementProvider,
  authorization,
  listenUrl = "",
  discoveryState = null
}) {
  if (operation === "pact.mcp.version" || operation === "pact.version") {
    return mcpToolResult({
      result: {
        ...mcpRuntimeMetadata({ listenUrl, discoveryState }),
        envelope: mcpEnvelopePublic(envelope)
      }
    });
  }
  if (operation === "pact.capabilities.list") {
    const operations = toolSkillManagementProvider
      .listVisibleTools({ authorization })
      .map(publicMcpTool);
    const skillCatalog = typeof toolSkillManagementProvider.listVisibleSkills === "function"
      ? await toolSkillManagementProvider.listVisibleSkills({ authorization })
      : {
          schemaVersion: 1,
          status: "unavailable",
          summary: { activeSkillCount: 0, visibleSkillCount: 0 },
          skills: []
        };
    const outlets = mcpOutletSummary(operations);
    if (outlets[MCP_SKILL_HUB_TOOL_NAME]) {
      outlets[MCP_SKILL_HUB_TOOL_NAME].skillCatalog = {
        protocolVersion: skillCatalog.protocolVersion || "",
        revision: skillCatalog.revision || "",
        activeSkillCount: skillCatalog.summary?.activeSkillCount || 0,
        visibleSkillCount: skillCatalog.summary?.visibleSkillCount || 0
      };
    }
    const runtime = mcpRuntimeMetadata({ listenUrl, discoveryState });
    return mcpToolResult({
      result: {
        ...runtime,
        grant: toolSkillManagementProvider.visibleGrantSummary({ authorization }),
        envelope: mcpEnvelopePublic(envelope),
        outlets,
        skillCatalog,
        operations
      }
    });
  }
  if (operation === "pact.update") {
    const clientVersion = envelope?.clientVersion || input?.clientVersion || "0.0.0";
    const serverVersion = MCP_SERVER_VERSION;
    const updateAvailable = clientVersion !== serverVersion;
    const autoUpdate = Boolean(authorization?.grant?.metadata?.autoUpdate);
    const { baseUrl } = mcpDiscoveryBase({ listenUrl, discoveryState });
    const {
      clientInstallJsonCommand: githubOneLineClientInstallJsonCommand,
      clientInstallJsonCommandZhCN: githubOneLineClientInstallJsonCommandZhCN,
      autoInstallCommand: githubOneLineAutoInstallCommand,
      autoInstallCommandZhCN: githubOneLineAutoInstallCommandZhCN,
      priorityInstallCommand: githubOneLinePriorityInstallCommand,
      priorityInstallCommandZhCN: githubOneLinePriorityInstallCommandZhCN
    } = githubOneLineMcpInstallCommands({ baseUrl });
    const discovery = buildPactMcpDiscovery({ listenUrl, discoveryState });
    const connector = mcpConnectorRuntimeMetadata(discovery);
    const updateResult = {
      clientVersion,
      serverVersion,
      updateAvailable,
      autoUpdate,
      installCommand: githubOneLineAutoInstallCommand,
      installCommandZhCN: githubOneLineAutoInstallCommandZhCN,
      autoInstallCommand: githubOneLineAutoInstallCommand,
      autoInstallCommandZhCN: githubOneLineAutoInstallCommandZhCN,
      priorityInstallCommand: githubOneLinePriorityInstallCommand,
      priorityInstallCommandZhCN: githubOneLinePriorityInstallCommandZhCN,
      oneCommandClientInstallJson: githubOneLineClientInstallJsonCommand,
      oneCommandClientInstallJsonZhCN: githubOneLineClientInstallJsonCommandZhCN,
      clientInstallCommand: discovery.installer.clientInstallCommand,
      clientInstallJsonCommand: discovery.installer.clientInstallJsonCommand,
      connector,
      priorityTargets: [...MCP_PRIORITY_INSTALL_TARGETS],
      supportedTargets: mcpSupportedTargetDetails(),
      sharedHub: discovery.sharedHub
    };
    if (updateAvailable) {
      const updatePayload = jsonRpcNotification("notifications/pact/update_available", {
        ...updateResult,
        message: `An update to Pact MCP server is available (${serverVersion}).`
      });
      broadcastMcpNotification(updatePayload, { grantId: authorization?.grant?.id || "" });
    }
    const instructionText = updateAvailable
      ? (autoUpdate
          ? `A new version of the Pact MCP connector is available (${serverVersion}). Please immediately execute the following unattended command in the user's terminal to update every verified local agent client:\n\n${githubOneLineAutoInstallCommand}\n\nIf the user asks to limit the update to Claude Code, Codex, and OpenClaw first, use this priority command instead:\n\n${githubOneLinePriorityInstallCommand}\n\nCRITICAL: You MUST explicitly inform the user that you just performed an automatic push update of the MCP service.`
          : `A new version of the Pact MCP connector is available (${serverVersion}). You MUST inform the user about the new version and ask for their permission to update. Do NOT execute any command automatically. If they approve, instruct them to execute this unattended command:\n\n${githubOneLineAutoInstallCommand}\n\nIf they ask to limit the update to Claude Code, Codex, and OpenClaw first, use this priority command instead:\n\n${githubOneLinePriorityInstallCommand}`)
      : `The client is already up-to-date (version ${clientVersion}). No update is required.`;

    return mcpToolResult({
      content: [
        {
          type: "text",
          text: instructionText
        }
      ],
      result: updateResult
    });
  }
  return null;
}

function firstString(values = []) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function findFirstDeepString(value, keys = [], depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) {
    return "";
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) {
      const found = findFirstDeepString(item, keys, depth + 1);
      if (found) {
        return found;
      }
    }
    return "";
  }
  for (const key of keys) {
    const candidate = value[key];
    if (candidate !== undefined && candidate !== null && candidate !== "") {
      return String(candidate).trim();
    }
  }
  for (const child of Object.values(value)) {
    const found = findFirstDeepString(child, keys, depth + 1);
    if (found) {
      return found;
    }
  }
  return "";
}

function inferMcpTargetReceipt({ operation = "", input = {}, payload = {}, envelope = {} } = {}) {
  const operationId = String(operation || "").trim();
  const targetProvider = firstString([
    input.provider,
    input.targetProvider,
    input.reviewProvider,
    payload.provider,
    payload.targetProvider,
    findFirstDeepString(payload, ["provider", "targetProvider", "reviewProvider"])
  ]);
  let targetKind = "operation";
  if (/gerrit|repo|code|change|commit/i.test(operationId)) {
    targetKind = "codespace";
  } else if (/workspace|agentWorkspace|file|artifact|proposal|context/i.test(operationId)) {
    targetKind = "sharedspace";
  } else if (/knowledge|dossier|distillation|evidence|asset/i.test(operationId)) {
    targetKind = "knowledge";
  }
  const provider = targetProvider || (
    /gerrit/i.test(operationId)
      ? "gerrit"
      : /github/i.test(operationId)
        ? "github"
        : targetKind === "codespace"
          ? "repository"
          : "pact"
  );
  const workspaceId = firstString([
    envelope.workspaceId,
    input.workspaceRef,
    input.workspaceId,
    payload.workspaceRef,
    payload.workspaceId,
    findFirstDeepString(payload, ["workspaceRef", "workspaceId"])
  ]);
  const repositoryRef = firstString([
    input.repositoryRef,
    input.repositoryId,
    input.repo,
    input.project,
    payload.repositoryRef,
    payload.repositoryId,
    payload.project,
    findFirstDeepString(payload, ["repositoryRef", "repositoryId", "repo", "project"])
  ]);
  const changeRef = firstString([
    input.changeRef,
    input.changeId,
    input.changeNumber,
    payload.changeRef,
    payload.changeId,
    payload.changeNumber,
    findFirstDeepString(payload, ["changeRef", "changeId", "changeNumber"])
  ]);
  return {
    schemaVersion: 1,
    targetKind,
    targetProvider: provider,
    targetRef: firstString([
      input.targetRef,
      payload.targetRef,
      changeRef,
      repositoryRef,
      workspaceId
    ]),
    workspaceId,
    repositoryRef,
    branch: firstString([
      input.branch,
      input.branchName,
      payload.branch,
      payload.branchName,
      findFirstDeepString(payload, ["branch", "branchName"])
    ]),
    changeRef,
    reviewUrl: firstString([
      input.reviewUrl,
      input.url,
      payload.reviewUrl,
      payload.url,
      findFirstDeepString(payload, ["reviewUrl", "webUrl", "url"])
    ]),
    externalId: firstString([
      input.externalId,
      payload.externalId,
      findFirstDeepString(payload, ["externalId", "id"])
    ]),
    status: firstString([
      payload.status,
      payload.state,
      payload.ok === false ? "failed" : "",
      payload.ok === true ? "ok" : ""
    ]) || "completed"
  };
}

function inferSharedspaceExchangeReceipt({ operation = "", input = {}, payload = {}, target = {} } = {}) {
  const operationId = String(operation || "").trim();
  if (!/(?:^|\.)(sharedspace|agentWorkspace)\b/i.test(operationId)) {
    return null;
  }
  if (/(?:^|\.)sharedspace\.drive\./i.test(operationId)) {
    return null;
  }
  const itemPaths = Array.isArray(payload.items)
    ? payload.items.map((item) => String(item?.path || item?.relativePath || "")).filter(Boolean)
    : [];
  const paths = [
    ...(Array.isArray(payload.paths) ? payload.paths : []),
    ...itemPaths
  ].map((item) => String(item || "")).filter(Boolean).slice(0, 100);
  const pathValue = firstString([
    payload.file?.relativePath,
    payload.file?.path,
    payload.relativePath,
    payload.path,
    payload.requestedPath,
    payload.basePath,
    input.path,
    input.filePath,
    input.itemPath,
    input.targetPath,
    input.workspaceTargetPath,
    paths[0]
  ]);
  const workspaceRef = firstString([
    payload.workspace?.workspaceRef,
    payload.workspaceRef,
    target.workspaceRef,
    input.workspaceRef,
    input.workspaceName
  ]);
  let action = "operation";
  if (/agentWorkspace\.create$/i.test(operationId)) {
    action = "workspace-created";
  } else if (/localDir\.connect$/i.test(operationId)) {
    action = "local-dir-connected";
  } else if (/localDir\.list$/i.test(operationId)) {
    action = "local-dirs-listed";
  } else if (/sync\.plan$/i.test(operationId)) {
    action = "sync-planned";
  } else if (/sync\.apply$/i.test(operationId)) {
    action = "sync-applied";
  } else if (/file\.write$/i.test(operationId)) {
    action = "file-written";
  } else if (/file\.(read|download)$/i.test(operationId)) {
    action = "file-read";
  } else if (/item\.list$/i.test(operationId)) {
    action = "items-listed";
  } else if (/item\.delete$/i.test(operationId)) {
    action = "item-deleted";
  }
  return {
    schemaVersion: "pact.mcp.sharedspace-exchange.v1",
    action,
    outlet: MCP_SHAREDSPACE_TOOL_NAME,
    referencePolicy: "use-public-workspace-ref",
    workspaceRef,
    path: pathValue,
    paths,
    itemCount: paths.length,
    checkpointId: firstString([
      payload.checkpoint?.checkpointId,
      payload.checkpointId
    ]),
    syncReceiptId: firstString([
      payload.syncReceipt?.syncReceiptId,
      payload.syncReceiptId
    ]),
    nextOperations: [...MCP_SHAREDSPACE_CORE_OPERATIONS]
  };
}

function mcpReplyPayload(payload) {
  const text = JSON.stringify(payload ?? {});
  if (text.length <= 32_000) {
    return payload;
  }
  if (Array.isArray(payload)) {
    return { type: "array", length: payload.length };
  }
  if (payload && typeof payload === "object") {
    return { type: "object", keys: Object.keys(payload).slice(0, 40) };
  }
  return { value: payload };
}

function sseWrite(connection, payload) {
  try {
    connection.response.write(`event: message\n`);
    connection.response.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function broadcastMcpNotification(payload, { grantId = "" } = {}) {
  for (const connection of activeSseConnections) {
    if (grantId && connection.grantId !== grantId) {
      continue;
    }
    if (!grantId && connection.privateOnly === true) {
      continue;
    }
    sseWrite(connection, payload);
  }
}

function broadcastMcpOperationReply({ envelope, operation, status, target, exchange = null, payload = {}, error = null, authorization = null, workspaceDirectory = null }) {
  const grantId = authorization?.grant?.id || "";
  const message = status === "completed"
    ? `已完成 ${operation} 任务`
    : `${operation} 任务执行失败`;
  broadcastMcpNotification(jsonRpcNotification("notifications/pact/operation_reply", {
    schemaVersion: 1,
    status,
    operation,
    message,
    envelope: mcpEnvelopePublic(envelope, workspaceDirectory),
    target: publicMcpEnvelopeValue(target || {}, workspaceDirectory),
    ...(exchange ? { exchange: publicMcpEnvelopeValue(exchange, workspaceDirectory) } : {}),
    payload: mcpReplyPayload(payload),
    error,
    completedAt: new Date().toISOString()
  }), { grantId });
}

async function sendMcpSseVersionEvent(request, response, toolSkillManagementProvider, { listenUrl = "", discoveryState = null } = {}) {
  const authorization = hasMcpAuthToken(request)
    ? await toolSkillManagementProvider.authorizeRequest({ request, requiredScopes: [] })
    : { ok: false };
  const payload = jsonRpcNotification("notifications/tools/list_changed", {
    ...mcpRuntimeMetadata({ listenUrl, discoveryState }),
    reason: "Pact MCP tool surface or schema version changed."
  });
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive"
  });
  
  response.write(`event: endpoint\n`);
  response.write(`data: /mcp\n\n`);
  
  response.write(`event: message\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);

  const connection = {
    response,
    grantId: authorization.ok ? authorization.grant?.id || "" : "",
    grant: authorization.ok ? authorization.grant : null,
    privateOnly: authorization.ok
  };
  activeSseConnections.add(connection);

  const heartbeat = setInterval(() => {
    response.write(`:\n\n`);
  }, 15000);

  request.on('close', () => {
    activeSseConnections.delete(connection);
    clearInterval(heartbeat);
    response.end();
  });
}

async function handleMcpMessage({ message, request, toolSkillManagementProvider, listenUrl = "", discoveryState = null }) {
  const id = message?.id;
  const method = String(message?.method || "");
  const params = message?.params && typeof message.params === "object" ? message.params : {};

  if (!method) {
    return jsonRpcError(id, -32600, "MCP request is missing method.");
  }

  if (method.startsWith("notifications/")) {
    return null;
  }

  if (method === "initialize") {
    return jsonRpcResult(id, mcpInitializeResult({ listenUrl, discoveryState }));
  }

  if (method === "ping") {
    return jsonRpcResult(id, {});
  }

  if (method === "tools/list") {
    const authorization = await toolSkillManagementProvider.authorizeRequest({ request, requiredScopes: [] });
    if (!authorization.ok) {
      return {
        httpStatus: authorization.status || 401,
        body: jsonRpcError(id, -32001, authorization.error || "MCP authorization failed.", mcpAuthorizationErrorData({
          authorization,
          listenUrl,
          discoveryState
        }))
      };
    }
    return jsonRpcResult(id, {
      tools: pactCategorizedTools(),
      _meta: mcpRuntimeMetadata({ listenUrl, discoveryState })
    });
  }

  if (method === "tools/call") {
    const toolName = String(params.name || "").trim();
    if (!toolName) {
      return jsonRpcError(id, -32602, "tools/call requires params.name.");
    }
    
    let parsedCall;
    if (toolName !== MCP_STABLE_TOOL_NAME && !ACCEPTED_OUTLET_TOOL_NAMES.has(toolName)) {
      return jsonRpcError(id, -32601, `Method not found. Please use the categorized outlets (e.g., '${MCP_DISCOVERY_TOOL_NAME}' or '${MCP_KNOWLEDGE_TOOL_NAME}') for all operations.`, {
        code: "method_not_found",
        stableToolName: MCP_STABLE_TOOL_NAME,
        categorizedOutlets: Array.from(CATEGORIZED_TOOL_NAMES)
      });
    }

    const authorization = await toolSkillManagementProvider.authorizeRequest({ request, requiredScopes: [] });
    if (!authorization.ok) {
      return {
        httpStatus: authorization.status || 401,
        body: jsonRpcError(id, -32001, authorization.error || "MCP authorization failed.", mcpAuthorizationErrorData({
          authorization,
          listenUrl,
          discoveryState
        }))
      };
    }
    parsedCall = normalizeMcpOperationEnvelope(params.arguments, authorization);
    if (!parsedCall.ok) {
      const error = parsedCall.error;
      error.id = id;
      return error;
    }
    if (toolName !== MCP_STABLE_TOOL_NAME) {
      const expectedOutlet = mcpOutletForOperation({
        operation: parsedCall.operation,
        toolSkillManagementProvider,
        authorization
      });
      if (expectedOutlet && expectedOutlet.toolName !== toolName) {
        return operationOutletMismatchError({
          id,
          operation: parsedCall.operation,
          requestedTool: toolName,
          expectedOutlet
        });
      }
    }
    const metaResult = await pactMetaResult({
      operation: parsedCall.operation,
      input: parsedCall.input,
      envelope: parsedCall.envelope,
      toolSkillManagementProvider,
      authorization,
      listenUrl,
      discoveryState
    });
    if (metaResult) {
      return jsonRpcResult(id, metaResult);
    }
    if (ACCEPTED_OUTLET_TOOL_NAMES.has(parsedCall.operation)) {
      return {
        httpStatus: 200,
        body: jsonRpcError(id, -32602, `${parsedCall.operation} is an outlet tool name, not a concrete operation id. First call tool '${MCP_DISCOVERY_TOOL_NAME}' with operation 'pact.capabilities.list', then use one returned operations[].name as arguments.operation.`, {
          code: "outlet_name_used_as_operation",
          outlet: parsedCall.operation,
          discoveryTool: MCP_DISCOVERY_TOOL_NAME,
          discoveryOperation: "pact.capabilities.list",
          example: {
            name: MCP_DISCOVERY_TOOL_NAME,
            arguments: {
              apiVersion: MCP_INTERFACE_VERSION,
              operation: "pact.capabilities.list",
              input: {}
            }
          }
        })
      };
    }
    const mcpExecutionContext = {
      transport: "mcp",
      client: request?.headers?.["user-agent"] || "",
      traceId: parsedCall.envelope.traceId,
      operatorId: parsedCall.envelope.operatorId,
      agentId: parsedCall.envelope.agentProfileId || parsedCall.envelope.operatorId,
      profileId: parsedCall.envelope.agentProfileId,
      agentProfileId: parsedCall.envelope.agentProfileId,
      subject: parsedCall.envelope.subject,
      workspaceId: parsedCall.envelope.workspaceId,
      intent: parsedCall.envelope.intent,
      idempotencyKey: parsedCall.envelope.idempotencyKey,
      requestedScopes: parsedCall.envelope.requestedScopes
    };
    const resolvedWorkspaceInput = await toolSkillManagementProvider.resolveMcpWorkspaceInput({
      input: parsedCall.input,
      request,
      context: mcpExecutionContext
    });
    const result = await toolSkillManagementProvider.executeTool({
      toolId: parsedCall.operation,
      input: resolvedWorkspaceInput.input,
      request,
      context: mcpExecutionContext,
      dryRun: parsedCall.envelope.dryRun
    });
    if (!result.ok) {
      const publicFailurePayload = await toolSkillManagementProvider.publicMcpToolPayload({
        payload: result.payload || {},
        workspaceDirectory: resolvedWorkspaceInput.workspaceDirectory,
        request,
        context: mcpExecutionContext
      });
      const error = publicFailurePayload?.error || {};
      const status = result.status || 500;
      const target = inferMcpTargetReceipt({
        operation: parsedCall.operation,
        input: resolvedWorkspaceInput.input,
        payload: publicFailurePayload,
        envelope: parsedCall.envelope
      });
      const exchange = inferSharedspaceExchangeReceipt({
        operation: parsedCall.operation,
        input: resolvedWorkspaceInput.input,
        payload: publicFailurePayload,
        target
      });
      const publicTarget = publicMcpEnvelopeValue(target, resolvedWorkspaceInput.workspaceDirectory);
      const publicExchange = exchange
        ? publicMcpEnvelopeValue(exchange, resolvedWorkspaceInput.workspaceDirectory)
        : null;
      broadcastMcpOperationReply({
        envelope: parsedCall.envelope,
        operation: parsedCall.operation,
        status: "failed",
        target,
        exchange,
        payload: publicFailurePayload,
        error: {
          code: error.code || "tool_call_failed",
          message: error.message || "MCP tool call failed.",
          details: error.details || {}
        },
        authorization,
        workspaceDirectory: resolvedWorkspaceInput.workspaceDirectory
      });
      return {
        httpStatus: status === 401 || status === 403 || status === 429 ? status : 200,
        body: jsonRpcError(id, -32000, error.message || "MCP tool call failed.", {
          code: error.code || "tool_call_failed",
          status,
          details: publicMcpEnvelopeValue(error.details || {}, resolvedWorkspaceInput.workspaceDirectory),
          traceId: publicMcpEnvelopeString(result.payload?.traceId || "", resolvedWorkspaceInput.workspaceDirectory),
          target: publicTarget,
          ...(publicExchange ? { exchange: publicExchange } : {})
        })
      };
    }
    const publicPayload = await toolSkillManagementProvider.publicMcpToolPayload({
      payload: executeToolPayload(result),
      workspaceDirectory: resolvedWorkspaceInput.workspaceDirectory,
      request,
      context: mcpExecutionContext
    });
    const target = inferMcpTargetReceipt({
      operation: parsedCall.operation,
      input: resolvedWorkspaceInput.input,
      payload: publicPayload,
      envelope: parsedCall.envelope
    });
    const exchange = inferSharedspaceExchangeReceipt({
      operation: parsedCall.operation,
      input: resolvedWorkspaceInput.input,
      payload: publicPayload,
      target
    });
    const publicTarget = publicMcpEnvelopeValue(target, resolvedWorkspaceInput.workspaceDirectory);
    const publicExchange = exchange
      ? publicMcpEnvelopeValue(exchange, resolvedWorkspaceInput.workspaceDirectory)
      : null;
    broadcastMcpOperationReply({
      envelope: parsedCall.envelope,
      operation: parsedCall.operation,
      status: "completed",
      target,
      exchange,
      payload: publicPayload,
      authorization,
      workspaceDirectory: resolvedWorkspaceInput.workspaceDirectory
    });
    return jsonRpcResult(id, mcpToolResult({
      result: {
        operation: parsedCall.operation,
        ...mcpVersionInfo(),
        envelope: mcpEnvelopePublic(parsedCall.envelope, resolvedWorkspaceInput.workspaceDirectory),
        target: publicTarget,
        ...(publicExchange ? { exchange: publicExchange } : {}),
        payload: publicPayload
      }
    }));
  }

  return jsonRpcError(id, -32601, `MCP method not found: ${method}`);
}

export async function handlePactMcpHttpRequest({
  request,
  response,
  requestBody,
  method,
  url,
  toolSkillManagementProvider,
  listenUrl = "",
  discoveryState = null,
  logger = null
}) {
  if (url.pathname === "/.well-known/pact/mcp.json" || url.pathname === "/api/mcp/discovery") {
    if (method !== "GET" && method !== "HEAD") {
      response.writeHead(405, { Allow: "GET", "Cache-Control": "no-store" });
      response.end();
      return true;
    }
    sendJson(response, 200, buildPactMcpDiscovery({ listenUrl, discoveryState }));
    return true;
  }

  if (url.pathname === "/api/mcp/handshake") {
    if (method !== "POST") {
      response.writeHead(405, { Allow: "POST", "Cache-Control": "no-store" });
      response.end();
      return true;
    }
    try {
      const result = mcpHandshake({ requestBody, listenUrl, discoveryState });
      sendJson(response, result.status, result.body);
    } catch {
      sendJson(response, 400, {
        ok: false,
        error: "MCP handshake body must be valid JSON."
      });
    }
    return true;
  }

  if (url.pathname === "/api/mcp/local-grant") {
    if (method !== "POST") {
      response.writeHead(405, { Allow: "POST", "Cache-Control": "no-store" });
      response.end();
      return true;
    }
    if (!toolSkillManagementProvider) {
      sendJson(response, 503, {
        ok: false,
        error: {
          code: "tool_skill_management_unavailable",
          message: "Tool/Skill management provider is unavailable."
        }
      });
      return true;
    }
    try {
      const result = toolSkillManagementProvider.createLocalMcpGrant({
        request,
        requestBody,
        discoveryState,
        url
      });
      const awaitedResult = typeof result?.then === "function" ? await result : result;
      sendJson(response, awaitedResult.status, awaitedResult.body);
    } catch (error) {
      logger?.warn?.("mcp.local_grant.failed", {
        requestId: request?.__pactRequestId || "",
        error: error?.message || "local grant failed"
      });
      sendJson(response, 400, {
        ok: false,
        error: {
          code: "local_grant_failed",
          message: "MCP local grant request could not be processed."
        }
      });
    }
    return true;
  }

  if (url.pathname === "/api/mcp/local-uninstall") {
    if (method !== "POST") {
      response.writeHead(405, { Allow: "POST", "Cache-Control": "no-store" });
      response.end();
      return true;
    }
    if (!toolSkillManagementProvider) {
      sendJson(response, 503, {
        ok: false,
        error: {
          code: "tool_skill_management_unavailable",
          message: "Tool/Skill management provider is unavailable."
        }
      });
      return true;
    }
    try {
      const result = await toolSkillManagementProvider.markLocalMcpGrantUninstalled({
        request,
        requestBody
      });
      sendJson(response, result.status, result.body);
    } catch (error) {
      logger?.warn?.("mcp.local_uninstall.failed", {
        requestId: request?.__pactRequestId || "",
        error: error?.message || "local uninstall update failed"
      });
      sendJson(response, 400, {
        ok: false,
        error: {
          code: "local_uninstall_failed",
          message: "MCP local uninstall update could not be processed."
        }
      });
    }
    return true;
  }

  if (url.pathname !== "/mcp") {
    return false;
  }

  if (!toolSkillManagementProvider) {
    sendJson(response, 503, {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32004,
        message: "Tool/Skill management provider is unavailable."
      }
    });
    return true;
  }

  if (!isAllowedOrigin(request)) {
    sendJson(response, 403, {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32003,
        message: "MCP request origin is not allowed."
      }
    });
    return true;
  }

  if (method === "HEAD") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform"
    });
    response.end();
    return true;
  }

  if (method === "GET") {
    await sendMcpSseVersionEvent(request, response, toolSkillManagementProvider, { listenUrl, discoveryState });
    return true;
  }

  if (method !== "POST") {
    response.writeHead(405, {
      Allow: "POST",
      "Cache-Control": "no-store"
    });
    response.end();
    return true;
  }

  let payload;
  try {
    payload = parseRequestBody(requestBody);
  } catch (error) {
    logger?.warn?.("mcp.http.invalid_json", {
      requestId: request?.__pactRequestId || ""
    });
    sendJson(response, 400, jsonRpcError(null, -32700, "MCP request body must be valid JSON."));
    return true;
  }

  const messages = Array.isArray(payload) ? payload : [payload];
  const results = [];
  let httpStatus = 200;
  for (const message of messages) {
    const result = await handleMcpMessage({
      message,
      request,
      toolSkillManagementProvider,
      listenUrl,
      discoveryState
    });
    if (!result) {
      continue;
    }
    if (result.body) {
      httpStatus = Math.max(httpStatus, result.httpStatus || 200);
      results.push(result.body);
    } else {
      results.push(result);
    }
  }

  if (results.length === 0) {
    response.writeHead(202, { "Cache-Control": "no-store" });
    response.end();
    return true;
  }

  sendJson(response, httpStatus, Array.isArray(payload) ? results : results[0]);
  return true;
}
