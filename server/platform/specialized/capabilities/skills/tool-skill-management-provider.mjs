import {
  clientIpFromRequest,
  firstForwardedFor,
  isLocalHttpHost,
  isLocalHttpOrigin,
  isLoopbackAddress,
  originHost
} from "../../../common/security/trusted-client-ip.mjs";

export const TOOL_SKILL_MANAGEMENT_PROTOCOL_VERSION = "v0.0.1:tool:skill-management-1";
export const SKILL_HUB_DISCOVERY_PROTOCOL_VERSION = "v0.0.1:tool:skill-hub-discovery-1";
export const CAPABILITY_PACKAGE_LIFECYCLE_PROTOCOL_VERSION = "v0.0.1:tool:capability-package-lifecycle-1";
export const SKILL_REGISTRY_PROTOCOL_VERSION = "v0.0.1:tool:skill-registry-1";

const LOCAL_GRANT_MCP_SHAREDSPACE_TOOL_NAME = "pact.sharedspace";
const LOCAL_GRANT_MCP_CONNECTOR_PACKAGE = "pact-mcp-connector";
const LOCAL_GRANT_MCP_CONNECTOR_REPO = "Unka-Malloc/Pact";
const LOCAL_GRANT_BOOTSTRAP_CURL_FLAGS = "-fL --retry 3 --connect-timeout 20 -sS";
const LOCAL_GRANT_BOOTSTRAP_SCRIPT = "pact-mcp-install.sh";
const LOCAL_GRANT_BOOTSTRAP_SCRIPT_ZH_CN = "pact-mcp-install.zh-CN.sh";
const LOCAL_GRANT_PRIORITY_TARGETS = Object.freeze(["claude-code", "codex", "openclaw"]);
const LOCAL_GRANT_SHAREDSPACE_CORE_OPERATIONS = Object.freeze([
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

const LOCAL_GRANT_WRITE_TOOLSETS = Object.freeze([
  "pact.runtime.read",
  "pact.storage.read",
  "pact.jobs.read",
  "pact.agentLibrary.read",
  "pact.agentLibrary.write",
  "pact.storage.write",
  "pact.agent.workspace.read",
  "pact.agent.workspace",
  "pact.document.parse",
  "pact.result.export",
  "pact.repo.read"
]);

const LOCAL_GRANT_TARGET_MATCH = Object.freeze({
  openclaw: {
    toolsets: LOCAL_GRANT_WRITE_TOOLSETS,
    agentProfileId: "pact.mcp.openclaw"
  },
  "claude-code": {
    toolsets: LOCAL_GRANT_WRITE_TOOLSETS,
    agentProfileId: "pact.mcp.claude-code"
  },
  codex: {
    toolsets: LOCAL_GRANT_WRITE_TOOLSETS,
    agentProfileId: "pact.mcp.codex"
  },
  antigravity: {
    toolsets: LOCAL_GRANT_WRITE_TOOLSETS,
    agentProfileId: "pact.mcp.antigravity"
  },
  opencode: {
    toolsets: LOCAL_GRANT_WRITE_TOOLSETS,
    agentProfileId: "pact.mcp.opencode"
  },
  copilot: {
    toolsets: LOCAL_GRANT_WRITE_TOOLSETS,
    agentProfileId: "pact.mcp.copilot"
  },
  "kilo-code": {
    toolsets: LOCAL_GRANT_WRITE_TOOLSETS,
    agentProfileId: "pact.mcp.kilo-code"
  },
  cursor: {
    toolsets: LOCAL_GRANT_WRITE_TOOLSETS,
    agentProfileId: "pact.mcp.cursor"
  },
  hermes: {
    toolsets: LOCAL_GRANT_WRITE_TOOLSETS,
    agentProfileId: "pact.mcp.hermes"
  }
});

const LOCAL_GRANT_RISK_RANK = Object.freeze({
  read_only: 0,
  safe_write: 1,
  repair_write: 2,
  destructive: 3
});
const DEFAULT_RELAY_MCP_GRANT_TTL_MS = 15 * 60 * 1000;
const MAX_RELAY_MCP_GRANT_TTL_MS = 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function normalizeApiKeyHeader(request) {
  const headers = request?.headers || {};
  if (!headers.authorization && !headers["x-pact-tool-token"] && headers["x-pact-api-key"]) {
    headers["x-pact-tool-token"] = String(headers["x-pact-api-key"] || "").trim();
  }
}

function parseRequestBody(requestBody) {
  if (!requestBody || requestBody.length === 0) {
    return {};
  }
  return JSON.parse(requestBody.toString("utf8"));
}

function isSameOriginBrowserRequest(request) {
  const origin = String(request?.headers?.origin || "").trim();
  if (!origin) {
    return true;
  }
  if (origin === "null" || !isLocalHttpOrigin(origin)) {
    return false;
  }
  const host = String(request?.headers?.host || "").trim();
  if (!isLocalHttpHost(host)) {
    return false;
  }
  return originHost(origin) === host.toLowerCase();
}

function isLocalMcpPairingRequest(request) {
  const forwardedFor = firstForwardedFor(request);
  const host = String(request?.headers?.host || "").trim();
  return isLoopbackAddress(clientIpFromRequest(request)) &&
    isLocalHttpHost(host) &&
    (!forwardedFor || isLoopbackAddress(forwardedFor)) &&
    isSameOriginBrowserRequest(request);
}

function normalizeGrantTargets(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 16);
}

function normalizeGrantValues(value, limit = 64) {
  const items = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, limit);
}

function intersectGrantValues(requestedValue, allowedValue, limit = 64) {
  const allowed = normalizeGrantValues(allowedValue, limit);
  const requested = normalizeGrantValues(requestedValue, limit);
  if (requested.length === 0) {
    return allowed;
  }
  const allowedSet = new Set(allowed);
  return requested.filter((item) => allowedSet.has(item));
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

function isLocalMcpGrant(grant) {
  const metadata = grantMetadata(grant);
  return (
    String(metadata.issuedBy || "").trim() === "pact-mcp-local-pairing" ||
    String(grant?.type || "").trim() === "mcp-client" ||
    String(metadata.mcpServer || "").trim() === "pact-mcp-server"
  );
}

function normalizedTargetKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function normalizedGrantTargetKeys(value) {
  return normalizeGrantTargets(value)
    .map((target) => normalizedTargetKey(target))
    .filter(Boolean)
    .filter((target, index, values) => values.indexOf(target) === index);
}

function localMcpGrantTargetKeys(grant) {
  const metadata = grantMetadata(grant);
  return normalizedGrantTargetKeys([
    ...normalizeGrantTargets(metadata.targets),
    ...normalizeGrantTargets(metadata.mcpTarget)
  ]);
}

function localGrantTargetMatch(targets = []) {
  const matchedTargets = [];
  const unmatchedTargets = [];
  const toolsets = new Set();
  let agentProfileId = "";
  for (const target of targets) {
    const key = normalizedTargetKey(target);
    const profile = LOCAL_GRANT_TARGET_MATCH[key] || null;
    if (!profile) {
      unmatchedTargets.push(target);
      continue;
    }
    matchedTargets.push(target);
    if (!agentProfileId) {
      agentProfileId = profile.agentProfileId || "";
    }
    for (const toolset of profile.toolsets || []) {
      toolsets.add(toolset);
    }
  }
  return {
    matched: matchedTargets.length > 0,
    matchedTargets,
    unmatchedTargets,
    toolsets: [...toolsets],
    agentProfileId
  };
}

function localGrantSupportedTargets() {
  return Object.keys(LOCAL_GRANT_TARGET_MATCH);
}

function localGrantSupportedTargetDetails() {
  return Object.entries(LOCAL_GRANT_TARGET_MATCH).map(([target, profile]) => ({
    target,
    agentProfileId: profile.agentProfileId || "",
    toolsets: [...(profile.toolsets || [])],
    maxRisk: "safe_write"
  }));
}

function localGrantMatchedTargetDetails(targets = []) {
  return targets
    .map((target) => {
      const profile = LOCAL_GRANT_TARGET_MATCH[normalizedTargetKey(target)] || null;
      return profile
        ? {
            target,
            agentProfileId: profile.agentProfileId || "",
            toolsets: [...(profile.toolsets || [])],
            maxRisk: "safe_write"
          }
        : null;
    })
    .filter(Boolean);
}

function localGrantSharedspaceExchangeReceiptContract() {
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

function localGrantRequestBaseUrl({ request = null, discoveryState = null } = {}) {
  const activeServiceUrl = String(discoveryState?.activeServiceUrl || "").replace(/\/+$/, "");
  if (activeServiceUrl) {
    return activeServiceUrl;
  }
  const host = String(request?.headers?.host || "").trim();
  if (!host) {
    return "";
  }
  const forwardedProto = String(request?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || (request?.socket?.encrypted ? "https" : "http");
  return `${protocol}://${host}`.replace(/\/+$/, "");
}

function localGrantVmBaseUrl(baseUrl = "") {
  try {
    const parsed = new URL(baseUrl);
    return `${parsed.protocol}//host.orb.internal:${parsed.port || (parsed.protocol === "https:" ? "443" : "80")}`;
  } catch {
    return "";
  }
}

function localGrantShellQuote(value) {
  return `'${String(value || "").replace(/'/g, "'\\''")}'`;
}

function localGrantGithubOneLineCommand(scriptName = LOCAL_GRANT_BOOTSTRAP_SCRIPT) {
  return `/bin/sh -c "$(curl ${LOCAL_GRANT_BOOTSTRAP_CURL_FLAGS} https://github.com/${LOCAL_GRANT_MCP_CONNECTOR_REPO}/releases/latest/download/${scriptName})"`;
}

function localGrantGithubOneLineInstallCommands({ baseUrl = "" } = {}) {
  const urlArgs = baseUrl ? ` --url ${localGrantShellQuote(baseUrl)}` : "";
  const command = localGrantGithubOneLineCommand();
  const commandZhCN = localGrantGithubOneLineCommand(LOCAL_GRANT_BOOTSTRAP_SCRIPT_ZH_CN);
  const priorityTargets = LOCAL_GRANT_PRIORITY_TARGETS.join(",");
  const build = (oneLineCommand) => ({
    installCommand: urlArgs ? `${oneLineCommand} --${urlArgs}` : oneLineCommand,
    clientInstallJsonCommand: `${oneLineCommand} -- --target <client>${urlArgs} --json`,
    autoInstallCommand: `${oneLineCommand} -- --target auto${urlArgs} --json`,
    priorityInstallCommand: `${oneLineCommand} -- --target ${priorityTargets}${urlArgs} --json`
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
    githubOneLinePriorityInstallCommandZhCN: zhCN.priorityInstallCommand
  };
}

function localGrantConnectorMetadata({ request = null, discoveryState = null } = {}) {
  const baseUrl = localGrantRequestBaseUrl({ request, discoveryState });
  const urlArgs = baseUrl ? ` --url ${localGrantShellQuote(baseUrl)}` : "";
  const oneLineCommands = localGrantGithubOneLineInstallCommands({ baseUrl });
  return {
    packageName: LOCAL_GRANT_MCP_CONNECTOR_PACKAGE,
    priorityTargets: [...LOCAL_GRANT_PRIORITY_TARGETS],
    ...oneLineCommands,
    oneCommandInstall: oneLineCommands.githubOneLineInstallCommand,
    oneCommandInstallZhCN: oneLineCommands.githubOneLineInstallCommandZhCN,
    oneCommandClientInstallJson: oneLineCommands.githubOneLineClientInstallJsonCommand,
    oneCommandClientInstallJsonZhCN: oneLineCommands.githubOneLineClientInstallJsonCommandZhCN,
    oneCommandAutoInstall: oneLineCommands.githubOneLineAutoInstallCommand,
    oneCommandAutoInstallZhCN: oneLineCommands.githubOneLineAutoInstallCommandZhCN,
    oneCommandPriorityInstall: oneLineCommands.githubOneLinePriorityInstallCommand,
    oneCommandPriorityInstallZhCN: oneLineCommands.githubOneLinePriorityInstallCommandZhCN,
    discoverCommand: `npx ${LOCAL_GRANT_MCP_CONNECTOR_PACKAGE}@latest discover-local${urlArgs} --json`,
    scanCommand: `npx ${LOCAL_GRANT_MCP_CONNECTOR_PACKAGE}@latest scan${urlArgs} --json`,
    doctorCommand: `npx ${LOCAL_GRANT_MCP_CONNECTOR_PACKAGE}@latest doctor${urlArgs} --json`,
    clientInstallCommand: `npx ${LOCAL_GRANT_MCP_CONNECTOR_PACKAGE}@latest install --target <client>${urlArgs}`,
    clientInstallJsonCommand: `npx ${LOCAL_GRANT_MCP_CONNECTOR_PACKAGE}@latest install --target <client>${urlArgs} --json`,
    autoInstallCommand: `npx ${LOCAL_GRANT_MCP_CONNECTOR_PACKAGE}@latest install --target auto${urlArgs} --json`,
    priorityInstallCommand: `npx ${LOCAL_GRANT_MCP_CONNECTOR_PACKAGE}@latest install --target ${LOCAL_GRANT_PRIORITY_TARGETS.join(",")}${urlArgs} --json`
  };
}

function localGrantSharedHubContract({ request = null, discoveryState = null } = {}) {
  const baseUrl = localGrantRequestBaseUrl({ request, discoveryState });
  const vmBaseUrl = localGrantVmBaseUrl(baseUrl);
  return {
    canonicalMcpUrl: baseUrl ? `${baseUrl}/mcp` : "",
    vmMcpUrl: vmBaseUrl ? `${vmBaseUrl}/mcp` : "",
    clientPolicy: "discover-shared-hub-then-opt-in",
    defaultClientMutation: "none",
    directHttp: true,
    sharedspace: {
      outlet: LOCAL_GRANT_MCP_SHAREDSPACE_TOOL_NAME,
      referencePolicy: "use-public-workspace-ref",
      exchangeReceipt: localGrantSharedspaceExchangeReceiptContract(),
      coreOperations: [...LOCAL_GRANT_SHAREDSPACE_CORE_OPERATIONS]
    }
  };
}

function localGrantRiskRank(risk = "read_only") {
  return LOCAL_GRANT_RISK_RANK[String(risk || "read_only")] ?? 0;
}

function grantVisibleRisk(grant = null) {
  const metadata = grantMetadata(grant);
  return String(metadata.maxRisk || grant?.maxRisk || "read_only").trim() || "read_only";
}

function grantCanSeeTool(tool, grant = null) {
  if (!tool || tool.status !== "active" || !grant) {
    return false;
  }
  const deniedTools = new Set(normalizeGrantValues(grant.toolDeny || [], 256));
  if (deniedTools.has(tool.id)) {
    return false;
  }
  const allowedTools = new Set(normalizeGrantValues(grant.toolAllow || [], 256));
  if (allowedTools.size > 0 && !allowedTools.has(tool.id)) {
    return false;
  }
  const grantScopes = new Set(normalizeGrantValues(grant.scopes || [], 512));
  const missingScopes = (tool.requiredScopes || []).filter((scope) => !grantScopes.has(scope));
  if (missingScopes.length > 0) {
    return false;
  }
  const grantToolsets = new Set(normalizeGrantValues(grant.toolsets || [], 256));
  if (grantToolsets.size > 0 && !(tool.toolsets || []).some((toolset) => grantToolsets.has(toolset))) {
    return false;
  }
  return localGrantRiskRank(tool.risk || "read_only") <= localGrantRiskRank(grantVisibleRisk(grant));
}

function skillPackageRequiredScopes(skill = {}) {
  return skill.risk === "read_only" ? ["knowledge:read"] : ["knowledge:read", "knowledge:maintain"];
}

function skillPackageToolsets(skill = {}) {
  return skill.risk === "read_only" ? ["pact.agentLibrary.read"] : ["pact.agentLibrary.maintain"];
}

function publicSkillPackage(record = {}) {
  const manifest = record.manifest || {};
  const library = record.library || {};
  const skill = {
    packageId: manifest.packageId || "",
    name: manifest.name || "",
    version: manifest.version || "",
    title: manifest.title || manifest.name || "",
    description: manifest.description || "",
    owner: manifest.owner || "",
    source: manifest.source || "",
    capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : [],
    risk: manifest.risk || "read_only",
    status: record.status || "",
    activatedAt: record.activatedAt || "",
    lifecycleEventCount: Array.isArray(record.lifecycleEvents) ? record.lifecycleEvents.length : 0,
    mcpOutlet: "pact.skillHub",
    protocolVersion: manifest.protocolVersion || SKILL_REGISTRY_PROTOCOL_VERSION,
    library: {
      storage: library.storage || "",
      root: library.root || "",
      manifestPath: library.manifestPath || "",
      filesRoot: library.filesRoot || "",
      fileCount: Number(library.fileCount || 0),
      totalBytes: Number(library.totalBytes || 0),
      artifactDigestSha256: library.artifactDigestSha256 || ""
    }
  };
  return {
    ...skill,
    requiredScopes: skillPackageRequiredScopes(skill),
    toolsets: skillPackageToolsets(skill)
  };
}

function grantCanSeeSkill(skill, grant = null) {
  if (!skill || skill.status !== "active" || !grant) {
    return false;
  }
  const grantScopes = new Set(normalizeGrantValues(grant.scopes || [], 512));
  const missingScopes = skill.requiredScopes.filter((scope) => !grantScopes.has(scope));
  if (missingScopes.length > 0) {
    return false;
  }
  const grantToolsets = new Set(normalizeGrantValues(grant.toolsets || [], 256));
  if (grantToolsets.size > 0 && !skill.toolsets.some((toolset) => grantToolsets.has(toolset))) {
    return false;
  }
  return localGrantRiskRank(skill.risk || "read_only") <= localGrantRiskRank(grantVisibleRisk(grant));
}

function emptySkillCatalog({ status = "ok", error = "" } = {}) {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: SKILL_HUB_DISCOVERY_PROTOCOL_VERSION,
    lifecycleProtocolVersion: CAPABILITY_PACKAGE_LIFECYCLE_PROTOCOL_VERSION,
    skillRegistryProtocolVersion: SKILL_REGISTRY_PROTOCOL_VERSION,
    status,
    revision: "",
    summary: {
      activeSkillCount: 0,
      visibleSkillCount: 0
    },
    skills: [],
    ...(error ? { error } : {})
  };
}

function skillCatalogFromCapabilityPackages(registryDescription = {}, { authorization = null } = {}) {
  const activePackageIds = new Set(Object.values(registryDescription.activeByKey || {}).map((value) => String(value || "")));
  const activeSkills = (registryDescription.packages || [])
    .filter((record) => record?.manifest?.kind === "skill")
    .filter((record) => record.status === "active")
    .filter((record) => activePackageIds.has(String(record.manifest.packageId || "")))
    .map(publicSkillPackage);
  const visibleSkills = authorization?.grant
    ? activeSkills.filter((skill) => grantCanSeeSkill(skill, authorization.grant))
    : activeSkills;
  const revision = [
    registryDescription.updatedAt || "",
    ...visibleSkills.map((skill) => `${skill.packageId}:${skill.version}:${skill.library.artifactDigestSha256}`)
  ].filter(Boolean).join("|");
  return {
    ...emptySkillCatalog(),
    revision,
    summary: {
      activeSkillCount: activeSkills.length,
      visibleSkillCount: visibleSkills.length
    },
    skills: visibleSkills
  };
}

function hasSafetyConfirm(request = null) {
  const value = String(
    request?.headers?.["x-pact-safety-confirm"] ||
      request?.headers?.["x-pact-confirm"] ||
      ""
  ).toLowerCase();
  return ["1", "true", "yes"].includes(value);
}

function requestedLocalGrantMaxRisk(body = {}, resolved = {}) {
  const requested = String(body.maxRisk || body.max_risk || "").trim();
  if (LOCAL_GRANT_RISK_RANK[requested] !== undefined) {
    return requested;
  }
  const grantMode = String(body.grantMode || body.grant_mode || body.mode || "").trim();
  if (["maintain", "admin", "repair"].includes(grantMode)) {
    return "repair_write";
  }
  if (["write", "safe_write"].includes(grantMode)) {
    return "safe_write";
  }
  if (localGrantRiskRank(resolved.maxRisk) >= localGrantRiskRank("repair_write")) {
    return "safe_write";
  }
  return resolved.maxRisk || "read_only";
}

function denyLocalGrant(status, code, message, details = {}) {
  return {
    status,
    body: {
      ok: false,
      error: {
        code,
        message,
        details
      }
    }
  };
}

async function authorizeLocalGrantElevation({
  request,
  url,
  securityPermissions = null,
  resolved,
  requestedMaxRisk,
  matchedLocalTarget = false
}) {
  const resolvedRisk = String(resolved.maxRisk || "read_only");
  if (localGrantRiskRank(resolvedRisk) <= localGrantRiskRank("read_only")) {
    return null;
  }
  if (matchedLocalTarget && localGrantRiskRank(resolvedRisk) <= localGrantRiskRank("safe_write")) {
    return null;
  }
  if (!hasSafetyConfirm(request)) {
    return denyLocalGrant(
      403,
      "confirmation_required",
      "Write-capable MCP local grants require x-pact-safety-confirm: true.",
      { maxRisk: resolvedRisk }
    );
  }
  if (localGrantRiskRank(resolvedRisk) >= localGrantRiskRank("repair_write")) {
    if (localGrantRiskRank(requestedMaxRisk) < localGrantRiskRank("repair_write")) {
      return denyLocalGrant(
        403,
        "repair_grant_mode_required",
        "Repair-capable MCP local grants require grantMode=maintain or maxRisk=repair_write.",
        { maxRisk: resolvedRisk }
      );
    }
  }
  if (!securityPermissions || typeof securityPermissions.authorizeOperation !== "function") {
    return null;
  }
  const authorization = await securityPermissions.authorizeOperation({
    request,
    method: "POST",
    url,
    operation: {
      id: "mcp.local_grant",
      requiredScopes: ["runtime:admin"],
      skipCsrf: false
    }
  });
  if (!authorization.ok) {
    return denyLocalGrant(
      authorization.status || 403,
      authorization.status === 401 ? "console_unauthenticated" : "console_forbidden",
      authorization.error || "Write-capable MCP local grants require an authenticated console session.",
      { maxRisk: resolvedRisk }
    );
  }
  return null;
}

function workspaceName(workspace = {}) {
  return String(workspace.name || workspace.title || workspace.workspaceName || "").trim();
}

function publicWorkspaceRef(index) {
  return `workspace-${index + 1}`;
}

function workspaceDirectoryFromWorkspaces(workspaces = []) {
  const entries = [];
  const byId = new Map();
  const byRef = new Map();
  const byName = new Map();
  workspaces.forEach((workspace, index) => {
    const id = String(workspace?.workspaceId || "").trim();
    if (!id) {
      return;
    }
    const entry = {
      id,
      ref: publicWorkspaceRef(index),
      index: index + 1,
      name: workspaceName(workspace)
    };
    entries.push(entry);
    byId.set(id, entry);
    byRef.set(entry.ref.toLowerCase(), entry);
    byRef.set(String(entry.index), entry);
    if (entry.name) {
      byName.set(entry.name.toLowerCase(), entry);
    }
  });
  return { entries, byId, byRef, byName };
}

function collectWorkspaces(value, output = []) {
  if (!value || typeof value !== "object") {
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectWorkspaces(item, output);
    }
    return output;
  }
  if (Array.isArray(value.workspaces)) {
    output.push(...value.workspaces.filter((item) => item && typeof item === "object"));
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      collectWorkspaces(child, output);
    }
  }
  return output;
}

function executeToolPayload(result = {}) {
  return result.payload?.result !== undefined ? result.payload.result : result.payload;
}

function resolveWorkspaceReference(directory, value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  if (directory.byId.has(raw)) {
    return raw;
  }
  const byRef = directory.byRef.get(raw.toLowerCase());
  if (byRef) {
    return byRef.id;
  }
  const byName = directory.byName.get(raw.toLowerCase());
  if (byName) {
    return byName.id;
  }
  return "";
}

function inputMayNeedWorkspaceResolution(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(inputMayNeedWorkspaceResolution);
  }
  return Object.entries(value).some(([key, child]) => {
    if (/workspace(Ref|Refs|Index|Name)$/i.test(key) || /^workspace-(ref|refs|index|name)$/i.test(key)) {
      return true;
    }
    if (/workspaceId$/i.test(key) && typeof child === "string" && !String(child).startsWith("workspace_")) {
      return true;
    }
    return inputMayNeedWorkspaceResolution(child);
  });
}

function resolveWorkspaceReferencesInInput(value, directory) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveWorkspaceReferencesInInput(item, directory));
  }
  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (/workspaceRef$/i.test(key)) {
      const idKey = key.replace(/Ref$/i, "Id");
      const resolved = resolveWorkspaceReference(directory, child);
      if (resolved) {
        next[idKey] = resolved;
      }
      next[key] = child;
      continue;
    }
    if (/workspaceRefs$/i.test(key) && Array.isArray(child)) {
      const idKey = key.replace(/Refs$/i, "Ids");
      const resolved = child.map((item) => resolveWorkspaceReference(directory, item)).filter(Boolean);
      if (resolved.length) {
        next[idKey] = resolved;
      }
      next[key] = child;
      continue;
    }
    if (/workspaceIndex$/i.test(key) || /workspaceName$/i.test(key)) {
      const resolved = resolveWorkspaceReference(directory, child);
      if (resolved && !next.workspaceId) {
        next.workspaceId = resolved;
      }
      next[key] = child;
      continue;
    }
    if (/^workspace-(index|name)$/i.test(key)) {
      const resolved = resolveWorkspaceReference(directory, child);
      if (resolved && !next.workspaceId) {
        next.workspaceId = resolved;
      }
      next[key] = child;
      continue;
    }
    if (/workspaceId$/i.test(key) && typeof child === "string") {
      next[key] = resolveWorkspaceReference(directory, child) || child;
      continue;
    }
    next[key] = resolveWorkspaceReferencesInInput(child, directory);
  }
  return next;
}

function isInternalAbsolutePath(value) {
  const text = String(value || "");
  return (
    /^\/(?:Users|home|root|private|var|tmp|opt|usr|Volumes)\//.test(text) ||
    /^[A-Za-z]:[\\/]/.test(text)
  );
}

function publicWorkspaceToken(directory, workspaceId) {
  const entry = directory.byId.get(String(workspaceId || ""));
  return entry?.ref || "workspace-hidden";
}

function sanitizeInternalWorkspaceIds(value, directory = workspaceDirectoryFromWorkspaces([])) {
  return String(value || "").replace(/\bworkspace_[A-Za-z0-9_]+\b/g, (workspaceId) =>
    publicWorkspaceToken(directory, workspaceId)
  );
}

function sanitizeInternalPaths(value) {
  return String(value || "")
    .replace(/(^|[\s"'=:(])((?:\/(?:Users|home|root|private|var|tmp|opt|usr|Volumes)\/)[^\s"',)\]}]+)/g, "$1[server-internal-path]")
    .replace(/(^|[\s"'=:(])([A-Za-z]:[\\/][^\s"',)\]}]+)/g, "$1[server-internal-path]");
}

function sanitizeSensitiveMcpText(value) {
  return String(value || "")
    .replace(/\b(Authorization\s*:\s*Bearer\s+)[^\s"',;)\]}]+/gi, "$1<redacted-token>")
    .replace(/\b(X-Pact-Api-Key\s*:\s*)[^\s"',;)\]}]+/gi, "$1<redacted-token>")
    .replace(/\b(x-pact-tool-token\s*:\s*)[^\s"',;)\]}]+/gi, "$1<redacted-token>")
    .replace(/(^|[\s"'=:(])(--token(?:=|\s+))[^\s"',;)\]}]+/gi, "$1$2<redacted-token>")
    .replace(/\b(token|access_token|refresh_token|api_key|apiKey|secret|password)=([^\s"',;)\]}]+)/gi, "$1=<redacted-secret>");
}

function sanitizeMcpString(value, directory = workspaceDirectoryFromWorkspaces([])) {
  const text = String(value || "");
  if (isInternalAbsolutePath(text)) {
    return "[server-internal-path]";
  }
  return sanitizeSensitiveMcpText(sanitizeInternalWorkspaceIds(sanitizeInternalPaths(text), directory));
}

function valueContainsWorkspaceId(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(valueContainsWorkspaceId);
  }
  return Object.entries(value).some(([key, child]) =>
    /workspaceId$/i.test(key) || valueContainsWorkspaceId(child)
  );
}

function sanitizeMcpOutputValue(value, directory = workspaceDirectoryFromWorkspaces([])) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMcpOutputValue(item, directory));
  }
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? sanitizeMcpString(value, directory) : value;
  }
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    const publicKey = sanitizeInternalWorkspaceIds(key, directory);
    if (isSensitiveMcpOutputKey(key)) {
      continue;
    }
    if (/^(fsPath|absolutePath|rootPath|databasePath|userDataPath)$/i.test(key)) {
      continue;
    }
    if (/path$/i.test(key) && typeof child === "string" && isInternalAbsolutePath(child)) {
      continue;
    }
    if (/^(ownerUserId|defaultAdminUserId|adminUserIds|userId|userIds)$/i.test(key)) {
      continue;
    }
    if (/workspaceIds$/i.test(key) && Array.isArray(child)) {
      const refKey = key.replace(/Ids$/i, "Refs");
      result[refKey] = child.map((item) => {
        const entry = directory.byId.get(String(item || ""));
        return entry?.ref || "workspace-hidden";
      });
      continue;
    }
    if (/workspaceId$/i.test(key)) {
      const refKey = key.replace(/Id$/i, "Ref");
      if (child === null || child === undefined || child === "") {
        result[refKey] = null;
        continue;
      }
      const entry = directory.byId.get(String(child || ""));
      result[refKey] = entry?.ref || "workspace-hidden";
      if (key === "workspaceId" && entry) {
        result.workspaceIndex = entry.index;
        result["workspace-index"] = entry.index;
        result.workspaceName = entry.name;
        result["workspace-name"] = entry.name;
      }
      continue;
    }
    result[publicKey] = sanitizeMcpOutputValue(child, directory);
  }
  if (value.workspaceId && !result.workspaceRef) {
    const entry = directory.byId.get(String(value.workspaceId || ""));
    result.workspaceRef = entry?.ref || "workspace-hidden";
    if (entry) {
      result.workspaceIndex = entry.index;
      result.workspaceName = entry.name;
    }
  }
  if (value.title && !result.workspaceName && value.workspaceId) {
    result.workspaceName = String(value.title || "");
    result["workspace-name"] = String(value.title || "");
  }
  return result;
}

function isSensitiveMcpOutputKey(key = "") {
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

function compactText(value) {
  return String(value || "").trim();
}

function positiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseTime(value = "") {
  const parsed = Date.parse(compactText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveRelayMcpGrantExpiry({
  input = {},
  sourceGrant = {},
  nowMs = Date.now()
} = {}) {
  const defaultTtlMs = positiveInteger(
    input.defaultTtlMs ?? input.relayMcpDefaultTtlMs ?? process.env.PACT_ACP_RELAY_MCP_GRANT_TTL_MS,
    DEFAULT_RELAY_MCP_GRANT_TTL_MS
  );
  const maxTtlMs = positiveInteger(
    input.maxTtlMs ?? input.relayMcpMaxTtlMs ?? process.env.PACT_ACP_RELAY_MCP_GRANT_MAX_TTL_MS,
    MAX_RELAY_MCP_GRANT_TTL_MS
  );
  const requestedTtlMs = positiveInteger(input.ttlMs ?? input.relayMcpTtlMs, 0);
  const requestedExpiresAtMs = parseTime(input.expiresAt ?? input.relayMcpExpiresAt);
  const sourceExpiresAtMs = parseTime(sourceGrant.expiresAt);
  const baseExpiryMs = requestedExpiresAtMs ||
    nowMs + Math.min(requestedTtlMs || defaultTtlMs, maxTtlMs);
  const caps = [
    baseExpiryMs,
    nowMs + maxTtlMs,
    ...(sourceExpiresAtMs ? [sourceExpiresAtMs] : [])
  ].filter((value) => Number.isFinite(value) && value > 0);
  const expiresAtMs = Math.min(...caps);
  return {
    ok: expiresAtMs > nowMs,
    expiresAt: new Date(expiresAtMs).toISOString(),
    ttlMs: Math.max(0, expiresAtMs - nowMs),
    requestedExpiresAt: requestedExpiresAtMs ? new Date(requestedExpiresAtMs).toISOString() : "",
    sourceExpiresAt: sourceExpiresAtMs ? new Date(sourceExpiresAtMs).toISOString() : "",
    maxTtlMs
  };
}

function relayMcpGrantReuseAllowed(existingGrant, {
  relaySessionId = "",
  sourceGrantId = "",
  virtualAgentId = "",
  targetId = ""
} = {}) {
  if (!existingGrant) {
    return true;
  }
  const metadata = grantMetadata(existingGrant);
  if (compactText(existingGrant.type) !== "relay-mcp-child") {
    return false;
  }
  if (compactText(metadata.issuedBy) !== "pact-acp-agent-relay") {
    return false;
  }
  if (compactText(metadata.relaySessionId) !== compactText(relaySessionId)) {
    return false;
  }
  if (compactText(metadata.sourceGrantId) !== compactText(sourceGrantId)) {
    return false;
  }
  const existingVirtualAgentId = compactText(metadata.virtualAgentId);
  const existingTargetId = compactText(metadata.targetId);
  return !(
    (existingVirtualAgentId && compactText(virtualAgentId) && existingVirtualAgentId !== compactText(virtualAgentId)) ||
    (existingTargetId && compactText(targetId) && existingTargetId !== compactText(targetId))
  );
}

function relayMcpGrantCollisionError(existingGrant, {
  requestedGrantId = "",
  relaySessionId = "",
  sourceGrantId = ""
} = {}) {
  const metadata = grantMetadata(existingGrant);
  return {
    ok: false,
    status: 409,
    error: {
      code: "relay_mcp_grant_id_collision",
      message: "Relay MCP child grant id is already bound to another owner.",
      details: {
        requestedGrantId: compactText(requestedGrantId),
        requestedRelaySessionId: compactText(relaySessionId),
        requestedSourceGrantId: compactText(sourceGrantId),
        existingType: compactText(existingGrant?.type),
        existingIssuedBy: compactText(metadata.issuedBy),
        existingRelaySessionId: compactText(metadata.relaySessionId),
        existingSourceGrantId: compactText(metadata.sourceGrantId)
      }
    }
  };
}

function slugText(value, fallback = "target") {
  const normalized = compactText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function mcpGrantConnectionState(grant, { offlineAfterSeconds = 300 } = {}) {
  if (compactText(grant?.revokedAt)) {
    return { state: "revoked", label: "已撤销", migrationState: "offline" };
  }
  if (grant?.enabled === false) {
    return { state: "disabled", label: "停用", migrationState: "offline" };
  }

  const lastUsedAt = compactText(grant?.lastUsedAt);
  if (!lastUsedAt) {
    return { state: "offline", label: "离线", migrationState: "offline" };
  }

  const ageSeconds = Math.max(0, Math.floor((Date.now() - new Date(lastUsedAt).getTime()) / 1000));
  if (!Number.isFinite(ageSeconds) || ageSeconds > Math.max(30, Number(offlineAfterSeconds) || 300)) {
    return { state: "offline", label: "离线", migrationState: "offline" };
  }

  return { state: "connected", label: "在线", migrationState: "unknown" };
}

function isMcpGrantTargetUninstalled(grant, target) {
  const metadata = grantMetadata(grant);
  const uninstalledTargets = normalizedGrantTargetKeys(metadata.uninstalledTargets);
  if (uninstalledTargets.includes(normalizedTargetKey(target))) {
    return true;
  }
  return metadata.currentDeviceVisible === false && Boolean(compactText(metadata.uninstalledAt));
}

function mcpGrantClientRows(grant, { offlineAfterSeconds = 300 } = {}) {
  const connection = mcpGrantConnectionState(grant, { offlineAfterSeconds });
  const metadata = grantMetadata(grant);
  const targets = localMcpGrantTargets(grant).length > 0
    ? localMcpGrantTargets(grant)
    : [compactText(grant?.label).replace(/\s*\(MCP Client\)\s*$/i, "") || compactText(grant?.id) || "MCP 插件"];
  return targets
    .filter((target) => !isMcpGrantTargetUninstalled(grant, target))
    .map((target, index) => {
      const targetKey = targets.length > 1 ? `${slugText(target)}-${index + 1}` : slugText(target);
      const lastSeenAt = compactText(grant.lastUsedAt || grant.updatedAt || grant.createdAt);
      return {
        clientId: `mcp:${grant.id}:${targetKey}`,
        clientLabel: target || grant.label || grant.id,
        appVersion: compactText(metadata.connectorVersion),
        platform: "MCP 插件",
        hostname: target || "",
        bootstrapUrl: "",
        currentServiceUrl: "",
        desiredServiceUrl: "",
        currentJobServiceUrl: "",
        configVersion: "",
        migrationState: connection.migrationState,
        connectionKind: "mcp-plugin",
        connectionMethod: "MCP 服务",
        connectionState: connection.state,
        connectionStatusLabel: connection.label,
        connectionDetail: "Tool Management 授权",
        supportsMigration: false,
        sourceGrantId: grant.id,
        busy: false,
        lastJobId: "",
        lastError: "",
        firstSeenAt: compactText(grant.createdAt),
        lastSeenAt,
        lastSeenServerId: compactText(metadata.serverId)
      };
    });
}

export function createToolSkillManagementProvider({
  toolManagementPlatform,
  userDataPath = "",
  capabilityPackageRegistry = null,
  skillHubEnabled = true,
  securityPermissions = toolManagementPlatform?.securityPermissions || null,
  logger = null
} = {}) {
  const platform = toolManagementPlatform;
  let skillPackageRegistry = capabilityPackageRegistry || null;
  const skillHubAvailable = skillHubEnabled !== false;

  async function getSkillPackageRegistry() {
    if (!skillHubAvailable) {
      return null;
    }
    if (!skillPackageRegistry) {
      const { createCapabilityPackageRegistry } = await import("../package-lifecycle/index.mjs");
      skillPackageRegistry = createCapabilityPackageRegistry({ userDataPath });
    }
    return skillPackageRegistry;
  }

  async function loadMcpWorkspaceDirectory({ request, context = {} }) {
    const result = await executeTool({
      toolId: "pact.agentWorkspace.list",
      input: {},
      request,
      context: {
        ...context,
        transport: "mcp",
        internalPurpose: "workspace-reference-resolution"
      }
    });
    if (!result.ok) {
      return workspaceDirectoryFromWorkspaces([]);
    }
    return workspaceDirectoryFromWorkspaces(collectWorkspaces(executeToolPayload(result)));
  }

  function requirePlatform() {
    if (!platform) {
      throw new Error("Tool/Skill management provider is not connected to Tool Management platform.");
    }
    return platform;
  }

  async function authorizeRequest({ request, requiredScopes = [], recordUse = true } = {}) {
    const current = requirePlatform();
    if (!current.store?.authorizeRequest) {
      return {
        ok: false,
        status: 503,
        error: "Tool Management authorization is unavailable."
      };
    }
    normalizeApiKeyHeader(request);
    const authorization = await current.store.authorizeRequest({
      request,
      requiredScopes,
      recordUse
    });
    if (!authorization.ok && typeof current.securityPermissions?.appendDecision === "function") {
      current.securityPermissions.appendDecision({
        decisionId: `authz_mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        traceId: request?.__pactTraceContext?.traceId || request?.__pactRequestId || "",
        operationId: "mcp.request",
        toolId: "",
        grantId: authorization.grant?.id || "",
        subject: authorization.grant
          ? {
              type: "tool-grant",
              subjectId: authorization.grant.id,
              username: authorization.grant.label || authorization.grant.id,
              scopes: authorization.grant.scopes || []
            }
          : {
              type: "anonymous",
              subjectId: "",
              scopes: []
            },
        resource: {
          operationId: "mcp.request",
          toolId: "",
          risk: "read_only"
        },
        action: "mcp.authorize",
        effect: "deny",
        allowed: false,
        reasonCode: authorization.reasonCode || "mcp_authorization_denied",
        redactedReason: authorization.error || "MCP authorization denied.",
        requiredScopes,
        missingScopes: authorization.missingScopes || [],
        evaluatedLayers: ["mcp_token_authorization"],
        createdAt: nowIso()
      });
    }
    return authorization;
  }

  function visibleGrantSummary({ authorization = null } = {}) {
    const grant = authorization?.grant || null;
    return {
      id: grant?.id || "",
      label: grant?.label || "",
      toolsets: grant?.toolsets || [],
      scopes: grant?.scopes || [],
      maxRisk: grantVisibleRisk(grant)
    };
  }

  function listVisibleTools({ authorization = null } = {}) {
    const current = requirePlatform();
    const catalog = current.catalog?.() || { tools: [] };
    const grant = authorization?.grant || null;
    return (catalog.tools || [])
      .filter((tool) => tool.status === "active")
      .filter((tool) => !grant || grantCanSeeTool(tool, grant));
  }

  async function listVisibleSkills({ authorization = null } = {}) {
    if (!skillHubAvailable) {
      return emptySkillCatalog({ status: "disabled" });
    }
    try {
      const registry = await getSkillPackageRegistry();
      return skillCatalogFromCapabilityPackages(await registry.describe(), { authorization });
    } catch (error) {
      logger?.warn?.("tool_skill_management.skill_catalog.failed", {
        error: error?.message || "skill catalog projection failed"
      });
      return emptySkillCatalog({
        status: "unavailable",
        error: "Skill catalog projection failed."
      });
    }
  }

  async function executeTool({ toolId, input = {}, request = null, context = {}, dryRun = false } = {}) {
    const current = requirePlatform();
    if (!current.runtime?.executeTool) {
      return {
        ok: false,
        status: 503,
        payload: {
          error: {
            code: "tool_runtime_unavailable",
            message: "Tool execution runtime is unavailable."
          }
        }
      };
    }
    return current.runtime.executeTool({
      toolId,
      input,
      request,
      context,
      dryRun
    });
  }

  async function resolveMcpWorkspaceInput({ input, request, context = {} } = {}) {
    if (!inputMayNeedWorkspaceResolution(input)) {
      return { input, workspaceDirectory: null };
    }
    const workspaceDirectory = await loadMcpWorkspaceDirectory({ request, context });
    return {
      input: resolveWorkspaceReferencesInInput(input, workspaceDirectory),
      workspaceDirectory
    };
  }

  async function publicMcpToolPayload({ payload, workspaceDirectory, request, context = {} } = {}) {
    const workspaces = collectWorkspaces(payload);
    let directory = workspaces.length ? workspaceDirectoryFromWorkspaces(workspaces) : workspaceDirectory;
    if (!directory && valueContainsWorkspaceId(payload)) {
      directory = await loadMcpWorkspaceDirectory({ request, context });
    }
    return sanitizeMcpOutputValue(payload, directory || workspaceDirectoryFromWorkspaces([]));
  }

  async function createLocalMcpGrant({ request, requestBody, discoveryState = null, url = null } = {}) {
    const current = requirePlatform();
    if (!isLocalMcpPairingRequest(request)) {
      return {
        status: 403,
        body: {
          ok: false,
          error: {
            code: "local_pairing_required",
            message: "MCP local grant issuance is only available from the local machine."
          }
        }
      };
    }
    const body = parseRequestBody(requestBody);
    const targets = normalizeGrantTargets(body.targets || body.target || body.clientId);
    const requestedToolsets = normalizeGrantValues(body.toolsets || body.toolsetIds || body.toolset || []);
    const requestedScopes = normalizeGrantValues(body.scopes || body.scopeIds || body.scope || []);
    const toolAllow = normalizeGrantValues(body.toolAllow || body.tool_allow || []);
    const toolDeny = normalizeGrantValues(body.toolDeny || body.tool_deny || []);
    const targetMatch = localGrantTargetMatch(targets);
    const hasExplicitGrantRequest = requestedToolsets.length > 0 || requestedScopes.length > 0 || toolAllow.length > 0;
    const effectiveToolsets = hasExplicitGrantRequest ? requestedToolsets : targetMatch.toolsets;

    const resolved = current.registry.resolveToolset({
      toolsets: effectiveToolsets,
      toolAllow,
      toolDeny,
      scopes: requestedScopes
    });
    const toolsetsById = new Map(current.registry.listToolsets().map((toolset) => [toolset.id, toolset]));
    const blockedToolsets = resolved.toolsets.filter((toolsetId) => toolsetsById.get(toolsetId)?.grantable === false);
    if (blockedToolsets.length > 0) {
      return denyLocalGrant(403, "toolset_not_grantable", "Requested MCP toolset is not grantable.", {
        toolsets: blockedToolsets
      });
    }
    const requestedMaxRisk = requestedLocalGrantMaxRisk(body, resolved);
    const elevationDenied = await authorizeLocalGrantElevation({
      request,
      url,
      securityPermissions,
      resolved,
      requestedMaxRisk,
      matchedLocalTarget: targetMatch.matched && !hasExplicitGrantRequest
    });
    if (elevationDenied) {
      return elevationDenied;
    }
    const label = String(body.label || `Pact MCP ${targets.join(", ") || "local agent"}`).trim();
    const result = await current.store.createGrant({
      label,
      type: "machine",
      toolsets: resolved.toolsets,
      scopes: resolved.requiredScopes,
      toolAllow,
      toolDeny: [...new Set([...toolDeny, "pact.admin"])],
      metadata: {
        issuedBy: "pact-mcp-local-pairing",
        connectorVersion: String(body.connectorVersion || ""),
        autoUpdate: Boolean(body.autoUpdate),
        targets,
        targetMatch: targetMatch.matched,
        matchedTargets: targetMatch.matchedTargets,
        unmatchedTargets: targetMatch.unmatchedTargets,
        agentProfileId: String(body.agentProfileId || body.agent_profile_id || targetMatch.agentProfileId || ""),
        serverId: discoveryState?.serverId || "",
        identityKeyId: discoveryState?.mcpIdentity?.keyId || "",
        maxRisk: resolved.maxRisk || "read_only"
      },
      reason: "Issued by local Pact MCP connector pairing."
    });
    return {
      status: 201,
      body: {
        ok: true,
        schemaVersion: "v0.0.1:schema:definition-1",
        grant: result.grant,
        token: result.token,
        tokenPrefix: result.grant.tokenPrefix,
        toolsets: resolved.toolsets,
        scopes: resolved.requiredScopes,
        maxRisk: resolved.maxRisk,
        targets,
        priorityTargets: [...LOCAL_GRANT_PRIORITY_TARGETS],
        supportedTargets: localGrantSupportedTargets(),
        supportedTargetDetails: localGrantSupportedTargetDetails(),
        connector: localGrantConnectorMetadata({ request, discoveryState }),
        sharedHub: localGrantSharedHubContract({ request, discoveryState }),
        targetMatch: {
          matched: targetMatch.matched,
          matchedTargets: targetMatch.matchedTargets,
          unmatchedTargets: targetMatch.unmatchedTargets,
          agentProfileId: targetMatch.agentProfileId,
          matchedTargetDetails: localGrantMatchedTargetDetails(targetMatch.matchedTargets)
        }
      }
    };
  }

  async function markLocalMcpGrantUninstalled({ request, requestBody } = {}) {
    const current = requirePlatform();
    if (!isLocalMcpPairingRequest(request)) {
      return {
        status: 403,
        body: {
          ok: false,
          error: {
            code: "local_pairing_required",
            message: "MCP local uninstall updates are only available from the local machine."
          }
        }
      };
    }

    const body = parseRequestBody(requestBody);
    const targets = normalizeGrantTargets(body.targets || body.target || body.clientId);
    const targetKeys = normalizedGrantTargetKeys(targets);
    if (targets.length === 0) {
      return denyLocalGrant(
        400,
        "targets_required",
        "MCP local uninstall updates require at least one target."
      );
    }

    const authorization = await authorizeRequest({
      request,
      requiredScopes: [],
      recordUse: false
    });
    if (!authorization.ok) {
      return denyLocalGrant(
        authorization.status || 401,
        authorization.reasonCode === "missing_token" ? "local_uninstall_token_required" : authorization.reasonCode || "local_uninstall_token_denied",
        authorization.error || "MCP local uninstall updates require a valid local MCP token."
      );
    }
    const authorizedGrant = authorization.grant || null;
    if (!isLocalMcpGrant(authorizedGrant)) {
      return denyLocalGrant(
        403,
        "local_uninstall_local_grant_required",
        "MCP local uninstall updates require a local MCP connector grant."
      );
    }
    const authorizedTargets = localMcpGrantTargetKeys(authorizedGrant);
    const unauthorizedTargets = targets.filter((target) => !authorizedTargets.includes(normalizedTargetKey(target)));
    if (unauthorizedTargets.length > 0) {
      return denyLocalGrant(
        403,
        "local_uninstall_target_denied",
        "MCP local uninstall token is not bound to every requested target.",
        {
          unauthorizedTargets,
          authorizedTargets
        }
      );
    }

    const store = current.store;
    if (typeof store?.listGrants !== "function" || typeof store?.updateGrant !== "function") {
      return denyLocalGrant(
        503,
        "tool_management_unavailable",
        "Tool management storage is not available."
      );
    }

    const targetSet = new Set(targetKeys);
    const uninstalledAt = nowIso();
    const updated = [];
    const grants = store.listGrants({ includeRevoked: true });
    for (const grant of grants) {
      if (!isLocalMcpGrant(grant)) {
        continue;
      }
      const grantTargets = localMcpGrantTargets(grant);
      const matchedTargets = grantTargets.filter((target) => targetSet.has(normalizedTargetKey(target)));
      if (matchedTargets.length === 0) {
        continue;
      }

      const metadata = grantMetadata(grant);
      const uninstalledTargets = [
        ...normalizedGrantTargetKeys(metadata.uninstalledTargets),
        ...matchedTargets.map((target) => normalizedTargetKey(target))
      ].filter((target, index, values) => values.indexOf(target) === index);
      const remainingTargets = grantTargets.filter((target) => !uninstalledTargets.includes(normalizedTargetKey(target)));
      const nextMetadata = {
        ...metadata,
        uninstalledTargets,
        lastUninstalledAt: uninstalledAt,
        lastUninstallConnectorVersion: String(body.connectorVersion || "")
      };
      if (remainingTargets.length === 0) {
        nextMetadata.uninstalledAt = nextMetadata.uninstalledAt || uninstalledAt;
        nextMetadata.currentDeviceVisible = false;
      } else if (nextMetadata.currentDeviceVisible === false) {
        nextMetadata.currentDeviceVisible = true;
      }

      const nextGrant = store.updateGrant(grant.id, {
        enabled: remainingTargets.length > 0 ? grant.enabled !== false : false,
        metadata: nextMetadata,
        reason: grant.reason || "Updated by local Pact MCP connector uninstall."
      });
      if (nextGrant) {
        updated.push({
          grantId: nextGrant.id,
          targets: matchedTargets,
          currentDeviceVisible: remainingTargets.length > 0
        });
      }
    }

    return {
      status: 200,
      body: {
        ok: true,
        schemaVersion: "v0.0.1:schema:definition-1",
        targets,
        authorizedGrantId: authorizedGrant.id || "",
        updatedCount: updated.length,
        updated
      }
    };
  }

  async function createAuthorizationGrant(input = {}) {
    const current = requirePlatform();
    return current.store.createGrant(input.grant || input);
  }

  async function revokeAuthorizationGrant(input = {}) {
    const current = requirePlatform();
    return current.store.revokeGrant(input.grantId || input["grant-id"] || input.id || "", input.reason || "");
  }

  async function createRelayMcpGrant(input = {}) {
    const current = requirePlatform();
    const sourceAuthorization = input.sourceAuthorization && typeof input.sourceAuthorization === "object"
      ? input.sourceAuthorization
      : {};
    const sourceGrant = sourceAuthorization.grant && typeof sourceAuthorization.grant === "object"
      ? sourceAuthorization.grant
      : null;
    if (!sourceGrant?.id) {
      return {
        ok: false,
        status: 403,
        error: {
          code: "relay_mcp_source_grant_required",
          message: "A verified source Tool Management grant is required before issuing a relay MCP grant."
        }
      };
    }

    const session = input.session && typeof input.session === "object" ? input.session : {};
    const route = input.route && typeof input.route === "object" ? input.route : {};
    const target = route.target && typeof route.target === "object" ? route.target : {};
    const virtualAgent = route.virtualAgent && typeof route.virtualAgent === "object" ? route.virtualAgent : {};
    const sourceAuthContext = input.sourceAuthContext && typeof input.sourceAuthContext === "object"
      ? input.sourceAuthContext
      : {};
    const requestedScopes = input.scopes ?? input.relayMcpScopes;
    const requestedToolsets = input.toolsets ?? input.relayMcpToolsets;
    const scopes = intersectGrantValues(requestedScopes, sourceGrant.scopes || sourceAuthContext.sourceScopes);
    const toolsets = intersectGrantValues(requestedToolsets, sourceGrant.toolsets || sourceAuthContext.sourceToolsets);
    const toolAllow = intersectGrantValues(input.toolAllow ?? input.relayMcpToolAllow, sourceGrant.toolAllow || [], 256);
    const capabilities = intersectGrantValues(
      input.capabilities ?? input.capabilityIds ?? input.relayMcpCapabilities,
      sourceGrant.capabilities || sourceAuthContext.sourceCapabilities || [],
      256
    );

    const relaySessionId = compactText(session.relaySessionId || input.relaySessionId);
    const relayTurnId = compactText(input.relayTurnId || input.turn?.relayTurnId);
    const targetId = compactText(target.targetId || input.targetId);
    const virtualAgentId = compactText(virtualAgent.virtualAgentId || input.virtualAgentId);
    const parentOperationId = compactText(input.parentOperationId || input.relayOperationId || input.operationId);
    const requestedGrantId = compactText(input.grantId || input.relayMcpGrantId || session.relayMcpGrantId);
    const traceContext = input.traceContext && typeof input.traceContext === "object" ? input.traceContext : {};
    const existingGrant = requestedGrantId && typeof current.store.getGrant === "function"
      ? current.store.getGrant(requestedGrantId)
      : null;
    if (existingGrant && !relayMcpGrantReuseAllowed(existingGrant, {
      relaySessionId,
      sourceGrantId: sourceGrant.id,
      virtualAgentId,
      targetId
    })) {
      return relayMcpGrantCollisionError(existingGrant, {
        requestedGrantId,
        relaySessionId,
        sourceGrantId: sourceGrant.id
      });
    }
    const expiry = resolveRelayMcpGrantExpiry({ input, sourceGrant });
    if (!expiry.ok) {
      return {
        ok: false,
        status: 403,
        error: {
          code: "relay_mcp_grant_expired",
          message: "Relay MCP child grant expiry is already elapsed or outside the source grant validity window.",
          details: {
            sourceGrantId: compactText(sourceGrant.id),
            sourceExpiresAt: expiry.sourceExpiresAt,
            requestedExpiresAt: expiry.requestedExpiresAt
          }
        }
      };
    }
    const grantResult = await current.store.createGrant({
      ...(requestedGrantId ? { id: requestedGrantId } : {}),
      label: compactText(input.label) || `ACP Relay MCP ${virtualAgentId || "agent"} -> ${targetId || "target"}`,
      type: "relay-mcp-child",
      enabled: true,
      scopes,
      toolsets,
      ...(toolAllow.length ? { toolAllow } : {}),
      ...(capabilities.length ? { capabilities } : {}),
      expiresAt: expiry.expiresAt,
      metadata: {
        issuedBy: "pact-acp-agent-relay",
        mcpServer: "pact-mcp-server",
        relayMcp: true,
        relayMcpGrantTtlMs: expiry.ttlMs,
        relayMcpGrantMaxTtlMs: expiry.maxTtlMs,
        relayMcpGrantExpiresAt: expiry.expiresAt,
        relaySessionId,
        relayTurnId,
        virtualAgentId,
        targetId,
        parentOperationId,
        workspaceId: compactText(session.workspaceId || route.workspaceId || input.workspaceId),
        sourceId: compactText(session.sourceId || input.sourceId),
        sourceSessionId: compactText(session.sourceSessionId || input.sourceSessionId),
        sourceSubjectId: compactText(session.sourceSubjectId || input.sourceSubjectId),
        sourceGrantId: compactText(sourceGrant.id),
        sourceGrantType: compactText(sourceGrant.type),
        sourceAuthSessionId: compactText(sourceAuthContext.authSessionId),
        sourceCredentialRef: compactText(sourceAuthContext.credentialRef),
        traceId: compactText(traceContext.traceId || input.traceId),
        requestId: compactText(traceContext.requestId || input.requestId),
        createdBy: "acp-agent-relay"
      },
      reason: compactText(input.reason) || `Delegated MCP grant for ACP relay session ${relaySessionId || "(pending)"}`
    });
    return {
      ok: true,
      status: 201,
      grant: grantResult.grant,
      token: grantResult.token
    };
  }

  async function revokeRelayMcpGrant(input = {}) {
    const current = requirePlatform();
    const grantId = compactText(input.grantId || input.relayMcpGrantId || input.id);
    if (!grantId) {
      return null;
    }
    const grant = typeof current.store.getGrant === "function" ? current.store.getGrant(grantId) : null;
    if (grant) {
      const metadata = grantMetadata(grant);
      if (compactText(metadata.issuedBy) !== "pact-acp-agent-relay") {
        return null;
      }
    }
    return current.store.revokeGrant(grantId, input.reason || "ACP relay MCP child grant revoked.");
  }

  function createMcpAuthorizationRequest(input = {}, { request = null } = {}) {
    const current = requirePlatform();
    return current.store.createMcpAuthorizationRequest({
      request,
      clientName: String(input.clientName || input.name || "").trim(),
      requestedScopes: Array.isArray(input.requestedScopes) ? input.requestedScopes : [],
      requestedTools: Array.isArray(input.requestedTools) ? input.requestedTools : [],
      reason: String(input.reason || "").trim()
    });
  }

  function listMcpAuthorizationRequests(input = {}) {
    const current = requirePlatform();
    return current.store.listMcpAuthorizationRequests({
      status: input.status || "pending"
    });
  }

  async function resolveMcpAuthorizationRequest(input = {}) {
    const current = requirePlatform();
    const requestId = String(input.requestId || input["request-id"] || input.id || "").trim();
    const resolution = String(input.resolution || "").trim();
    let grantId = "";
    if (resolution === "approved") {
      const clientName = String(input.clientName || "MCP Client");
      const grantResult = await current.store.createGrant({
        label: `${clientName} (MCP Client)`,
        type: "mcp-client",
        scopes: Array.isArray(input.scopes) ? input.scopes : [],
        toolsets: Array.isArray(input.toolsets) ? input.toolsets : [],
        toolAllow: Array.isArray(input.toolAllow) ? input.toolAllow : [],
        enabled: true,
        reason: `Approved MCP authorization request ${requestId}`
      });
      grantId = grantResult.grant.id;
    }

    const success = current.store.resolveMcpAuthorizationRequest({
      requestId,
      resolution,
      grantId
    });
    return { success, grantId };
  }

  async function handleToolManagementHttpRequest(input = {}) {
    const current = requirePlatform();
    if (!current.router?.handleToolManagementHttpRequest) {
      return false;
    }
    return current.router.handleToolManagementHttpRequest(input);
  }

  function listMcpClientConnections({ offlineAfterSeconds = 300 } = {}) {
    const current = requirePlatform();
    if (typeof current.store?.listGrants !== "function") {
      return [];
    }
    try {
      return current.store.listGrants({ includeRevoked: true })
        .filter(isLocalMcpGrant)
        .flatMap((grant) => mcpGrantClientRows(grant, { offlineAfterSeconds }));
    } catch (error) {
      logger?.warn?.("tool_skill_management.client_connections.failed", {
        error: error?.message || "client connection projection failed"
      });
      return [];
    }
  }

  return Object.freeze({
    protocolVersion: TOOL_SKILL_MANAGEMENT_PROTOCOL_VERSION,
    describe() {
      return {
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: TOOL_SKILL_MANAGEMENT_PROTOCOL_VERSION,
        capabilities: [
          "tool_catalog",
          "tool_grants",
          "tool_execution",
          "mcp_local_grant",
          "mcp_relay_child_grant",
          "mcp_workspace_reference_projection",
          "skill_registry_surface",
          "active_skill_catalog"
        ]
      };
    },
    authorizeRequest,
    visibleGrantSummary,
    listVisibleTools,
    listVisibleSkills,
    executeTool,
    resolveMcpWorkspaceInput,
    publicMcpToolPayload,
    createLocalMcpGrant,
    markLocalMcpGrantUninstalled,
    createAuthorizationGrant,
    revokeAuthorizationGrant,
    createRelayMcpGrant,
    revokeRelayMcpGrant,
    createMcpAuthorizationRequest,
    listMcpAuthorizationRequests,
    resolveMcpAuthorizationRequest,
    handleToolManagementHttpRequest,
    listMcpClientConnections
  });
}
