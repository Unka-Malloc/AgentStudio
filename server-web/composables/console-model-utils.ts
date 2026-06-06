import type {
  AgentModelConfig,
  AgentModuleAccess,
  AgentPermissionGroup,
  AgentSettings,
  ModuleAgentProfile,
} from "../lib/types";
import type { CloudProvider } from "../types/app";
import {
  emptySettings,
  modelLibraryProviderDefinitions,
  moduleGroupDefinitions,
} from "./console-defaults";

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeModelLibraryEntries(value: unknown): CloudProvider[] {
  const allowed = new Set(modelLibraryProviderDefinitions.map((item) => item.id));
  const entries = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  return entries
    .map((item) => String(item || "").trim() as CloudProvider)
    .filter((item: any) => {
      if (!allowed.has(item) || seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    });
}

export function modelAgentUid(...parts: unknown[]) {
  const source = parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join("\n") || String(Date.now());
  let hash = 2166136261;
  let hash2 = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    hash ^= code;
    hash = Math.imul(hash, 16777619);
    hash2 ^= code + index + 1;
    hash2 = Math.imul(hash2, 16777619);
  }
  const partA = (hash >>> 0).toString(16).padStart(8, "0");
  const partB = (hash2 >>> 0).toString(16).padStart(8, "0");
  return `agent_${partA}${partB}`;
}

export function modelEntryStringField(entry: Partial<AgentModelConfig>, keys: string[]) {
  const record = asRecord(entry) || {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return String(record[key] ?? "").trim();
    }
  }
  return undefined;
}

export function modelProviderLabel(provider: CloudProvider | string) {
  switch (provider) {
    case "openai-chatgpt":
      return "ChatGPT";
    case "google-gemini":
      return "Gemini";
    case "openrouter":
      return "OpenRouter";
    case "deepseek":
      return "DeepSeek";
    case "copilot":
      return "Copilot";
    case "custom-http":
      return "HTTP Adapter";
    case "local-model":
      return "本地模型";
    default:
      return provider || "未知";
  }
}

export function normalizeAgentModelEntry(
  entry: Partial<AgentModelConfig>,
  index = 0,
  sourceSettings: AgentSettings = emptySettings,
): AgentModelConfig {
  const provider = String(entry.provider || "") as CloudProvider;
  const model = modelEntryStringField(entry, ["model", "engine"]) ?? "";
  const label =
    modelEntryStringField(entry, ["label", "agentName"]) ??
    (String(entry.alias || "").trim() || `${modelProviderLabel(provider)}${model ? ` ${model}` : " 智能体"}`.trim());
  const agentName = modelEntryStringField(entry, ["agentName", "label"]) ?? label;
  const engine = modelEntryStringField(entry, ["engine", "model"]) ?? "";
  const existingInstanceId = String(entry.instanceId || "").trim();
  const explicitUid = String(entry.uid || "").trim();
  const existingAlias = String(entry.alias || "").trim();
  const uid = explicitUid ||
    (existingInstanceId.startsWith("agent_") ? existingInstanceId : "") ||
    (existingAlias.startsWith("agent_") ? existingAlias : "") ||
    modelAgentUid(provider, existingInstanceId || existingAlias || index + 1);
  return {
    uid,
    instanceId: uid,
    provider,
    alias: uid,
    label,
    baseUrl: String(entry.baseUrl || (provider === "deepseek" ? sourceSettings.deepSeekBaseUrl : "") || "").trim(),
    url: String(entry.url || "").trim(),
    model,
    apiKey: String(entry.apiKey || "").trim(),
    apiKeyConfigured: entry.apiKeyConfigured === true,
    token: String(entry.token || "").trim(),
    tokenConfigured: entry.tokenConfigured === true,
    tokenHeader: String(entry.tokenHeader || "token").trim(),
    tokenPrefix: String(entry.tokenPrefix || "").trim(),
    agentName,
    engine,
    pluginList: Array.isArray(entry.pluginList) ? entry.pluginList : [],
    systemPrompt: String(entry.systemPrompt || "").trim(),
    parameters: asRecord(entry.parameters) || {},
    moduleAccess: normalizeAgentModuleAccess(entry.moduleAccess),
    permissionGroupId: String(entry.permissionGroupId || "").trim(),
    parametersText:
      String(entry.parametersText || "").trim() ||
      JSON.stringify(asRecord(entry.parameters) || {}, null, 2),
    timeoutMs: Number(entry.timeoutMs || (provider === "deepseek" ? sourceSettings.deepSeekTimeoutMs : 120000)),
  };
}

export function normalizeAgentModuleAccess(value?: Partial<AgentModuleAccess>): AgentModuleAccess {
  const record = asRecord(value) || {};
  const mode = String(record.mode || "").trim() === "selected" ? "selected" : "all";
  const moduleIds = Array.isArray(record.moduleIds)
    ? record.moduleIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  return {
    mode,
    moduleIds: [...new Set(moduleIds)],
  };
}

export function normalizeAgentPermissionGroupDraft(
  value: Partial<AgentPermissionGroup>,
  index = 0,
): AgentPermissionGroup {
  const record = asRecord(value) || {};
  const id =
    String(record.id || "").trim() ||
    `agent-permission-${Date.now()}-${index + 1}`;
  const normalizeList = (input: unknown) =>
    [...new Set(Array.isArray(input) ? input.map((item) => String(item || "").trim()).filter(Boolean) : [])];
  return {
    id,
    label: String(record.label || id).trim(),
    description: String(record.description || "").trim(),
    enabled: record.enabled !== false,
    scopeIds: normalizeList(record.scopeIds),
    toolsetIds: normalizeList(record.toolsetIds),
    toolAllow: normalizeList(record.toolAllow),
    toolDeny: normalizeList(record.toolDeny),
  };
}

export function normalizeAgentPermissionGroupsDraft(value: unknown): AgentPermissionGroup[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : [])
    .map((item, index) => normalizeAgentPermissionGroupDraft(item as Partial<AgentPermissionGroup>, index))
    .filter((item: any) => {
      if (!item.id || seen.has(item.id)) {
        return false;
      }
      seen.add(item.id);
      return true;
    });
}

export function modelEntryParameters(entry: AgentModelConfig) {
  try {
    return JSON.parse(String(entry.parametersText || "{}"));
  } catch {
    return asRecord(entry.parameters) || {};
  }
}

export function redactAgentModelEntryForExport(entry: AgentModelConfig) {
  return {
    ...entry,
    apiKey: "",
    apiKeyConfigured: Boolean(entry.apiKey || entry.apiKeyConfigured),
    token: "",
    tokenConfigured: Boolean(entry.token || entry.tokenConfigured),
  };
}

export function redactedProviderSettingsForAgentExport(
  entry: AgentModelConfig,
  settings: AgentSettings,
  options: { codexOAuthConfigured?: boolean } = {},
) {
  const provider = String(entry.provider || "");
  if (provider === "google-gemini") {
    return {
      provider,
      googleModel: entry.model || settings.googleModel,
      googleApiKeyConfigured: Boolean(settings.googleApiKey || settings.googleApiKeyConfigured),
    };
  }
  if (provider === "openai-chatgpt") {
    return {
      provider,
      openAiModel: entry.model || settings.openAiModel,
      codexOAuthConfigured: Boolean(options.codexOAuthConfigured),
    };
  }
  if (provider === "deepseek") {
    return {
      provider,
      deepSeekBaseUrl: entry.baseUrl || settings.deepSeekBaseUrl,
      deepSeekModel: entry.model || settings.deepSeekModel,
      deepSeekApiKeyConfigured: Boolean(
        entry.apiKey ||
          entry.apiKeyConfigured ||
          settings.deepSeekApiKey ||
          settings.deepSeekApiKeyConfigured,
      ),
      deepSeekTimeoutMs: Number(entry.timeoutMs || settings.deepSeekTimeoutMs || 120000),
    };
  }
  if (provider === "openrouter") {
    return {
      provider,
      openRouterBaseUrl: settings.openRouterBaseUrl,
      openRouterModel: entry.model || settings.openRouterModel,
      openRouterApiKeyConfigured: Boolean(settings.openRouterApiKey || settings.openRouterApiKeyConfigured),
    };
  }
  if (provider === "copilot") {
    return {
      provider,
      copilotEndpoint: settings.copilotEndpoint,
      copilotModel: entry.model || settings.copilotModel,
      copilotApiKeyConfigured: Boolean(settings.copilotApiKey || settings.copilotApiKeyConfigured),
    };
  }
  if (provider === "local-model") {
    return {
      provider,
      localModelEndpoint: settings.localModelEndpoint,
      localModelName: entry.model || settings.localModelName,
    };
  }
  if (provider === "custom-http") {
    return {
      provider,
      url: entry.url || settings.customHttpAdapter?.url || "",
      tokenHeader: entry.tokenHeader || settings.customHttpAdapter?.tokenHeader || "token",
      tokenPrefix: entry.tokenPrefix || settings.customHttpAdapter?.tokenPrefix || "",
      tokenConfigured: Boolean(
        entry.token ||
          entry.tokenConfigured ||
          settings.customHttpAdapter?.token ||
          settings.customHttpAdapter?.tokenConfigured,
      ),
      timeoutMs: Number(entry.timeoutMs || settings.customHttpAdapter?.timeoutMs || 120000),
    };
  }
  return { provider };
}

export function moduleAgentProfileJson(value?: string, fallback?: Record<string, unknown>) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return asRecord(parsed) || {};
  } catch {
    return fallback || {};
  }
}

export function normalizeModuleAgentProfile(profile?: Partial<ModuleAgentProfile>): ModuleAgentProfile {
  const incoming = profile || {};
  const parameters = moduleAgentProfileJson(incoming.parametersText, asRecord(incoming.parameters) || {});
  const dependencyContext = moduleAgentProfileJson(
    incoming.dependencyContextText,
    asRecord(incoming.dependencyContext) || {},
  );
  return {
    enabled: incoming.enabled !== false,
    role: String(incoming.role || "primary").trim() || "primary",
    contextProfileId: String(incoming.contextProfileId || "").trim(),
    systemPrompt: String(incoming.systemPrompt || "").trim(),
    parameters,
    parametersText: String(incoming.parametersText || "").trim() || JSON.stringify(parameters, null, 2),
    dependencyContext,
    dependencyContextText:
      String(incoming.dependencyContextText || "").trim() ||
      JSON.stringify(dependencyContext, null, 2),
  };
}

export function normalizeModuleAgentProfilesForDraft(settings: AgentSettings) {
  const incoming = asRecord(settings.moduleAgentProfiles) || {};
  const next: AgentSettings["moduleAgentProfiles"] = {};
  for (const moduleDefinition of moduleGroupDefinitions) {
    const group = asRecord(incoming[moduleDefinition.id]) || {};
    const agents = asRecord(group.agents) || {};
    const nextAgents: Record<string, ModuleAgentProfile> = {};
    for (const [agentId, profile] of Object.entries(agents)) {
      const normalizedAgentId = String(agentId || "").trim();
      if (!normalizedAgentId) {
        continue;
      }
      nextAgents[normalizedAgentId] = normalizeModuleAgentProfile(profile as Partial<ModuleAgentProfile>);
    }
    const assignment = settings.moduleModelAssignments?.[moduleDefinition.id];
    const primaryAgent = String(group.primaryAgent || assignment?.model || "").trim();
    if (primaryAgent && !nextAgents[primaryAgent]) {
      nextAgents[primaryAgent] = normalizeModuleAgentProfile({ role: "primary" });
    }
    if (primaryAgent || Object.keys(nextAgents).length > 0) {
      next[moduleDefinition.id] = {
        primaryAgent,
        agents: nextAgents,
      };
    }
  }
  return next;
}

function isAbsoluteCommandPath(value: string) {
  return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value);
}

export function normalizeAgentLocalCommandsForDraft(settings: AgentSettings) {
  const localSettings = settings.agentToolExecution?.local || emptySettings.agentToolExecution.local;
  const nodeCommand = String(localSettings.nodeCommand || "").trim() || "node";
  const commands = Array.isArray(localSettings.commands)
    ? localSettings.commands
    : emptySettings.agentToolExecution.local.commands;
  return commands
    .map((item, index) => {
      const commandId = String(item.commandId || `command-${index + 1}`).trim();
      const command = String(item.command || "").trim();
      const isNodeVersion = commandId === "node-version";
      const variables = Array.isArray(item.variables) && item.variables.length > 0
        ? item.variables
        : isNodeVersion
          ? emptySettings.agentToolExecution.local.commands[0].variables
          : [];
      const rawArgs = Array.isArray(item.args) ? item.args.map((arg) => String(arg)) : [];
      return {
        ...item,
        commandId,
        label: String(item.label || item.commandId || `Command ${index + 1}`).trim(),
        command:
          commandId === "node-version" && (!command || isAbsoluteCommandPath(command))
            ? nodeCommand
            : command,
        args: isNodeVersion && !rawArgs.some((arg) => /\{\{\s*flag\s*\}\}/.test(arg))
          ? ["{{flag}}"]
          : rawArgs,
        cwd: String(item.cwd || "").trim(),
        description: String(item.description || "").trim(),
        variables,
        allowExtraArgs: isNodeVersion ? item.allowExtraArgs === true : item.allowExtraArgs,
      };
    })
    .filter((item) => item.commandId && item.command);
}
