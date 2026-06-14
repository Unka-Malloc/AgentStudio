import { getSettingsPath, loadSettings } from "../../common/platform-core/settings.mjs";
import { buildClientConnectionList } from "../../common/console/http/client-connection-list.mjs";

const AGENT_SELECTOR_SUPPORTED_PROVIDERS = new Set([
  "deepseek",
  "openrouter",
  "copilot",
  "custom-http",
  "local-model"
]);

function createFallbackAgentConfigRegistry() {
  return {
    async refresh() {
      return {
        rootPath: "",
        modelListPath: "",
        agentListPath: "",
        modelManifest: {},
        agentManifest: {}
      };
    },
    getModelLibraryEntries() {
      return [];
    },
    getModelLibraryAgents() {
      return [];
    }
  };
}

function stringValue(value) {
  return String(value || "").trim();
}

function agentSelectorUid(entry = {}) {
  return stringValue(entry.uid || entry.instanceId || entry.alias);
}

function agentSelectorLabel(entry = {}, agentUid = "") {
  const name = stringValue(entry.label || entry.agentName || entry.alias || agentUid);
  const model = stringValue(entry.model || entry.engine);
  return model && model !== name ? `${name} · ${model}` : name;
}

function agentSelectorModuleIds(entry = {}) {
  const access = entry?.moduleAccess && typeof entry.moduleAccess === "object"
    ? entry.moduleAccess
    : {};
  if (access.mode !== "selected") {
    return ["*"];
  }
  return Array.isArray(access.moduleIds)
    ? access.moduleIds.map((item) => stringValue(item)).filter(Boolean)
    : [];
}

function agentSelectorStatus(settings = {}, entry = {}) {
  const provider = stringValue(entry.provider);
  const model = stringValue(entry.model || entry.engine);
  const hasModel = Boolean(model);
  if (!AGENT_SELECTOR_SUPPORTED_PROVIDERS.has(provider)) {
    return {
      status: "unsupported",
      selectable: false,
      reason: "该智能体来源尚未接入服务端调用链路。"
    };
  }
  if (provider === "custom-http") {
    const hasUrl = Boolean(stringValue(entry.url || entry.baseUrl || settings.customHttpAdapter?.url));
    const hasToken = Boolean(entry.tokenConfigured || entry.apiKeyConfigured || stringValue(entry.token || entry.apiKey));
    if (!hasUrl || !hasToken) {
      return {
        status: "unconfigured",
        selectable: false,
        reason: "缺少调用地址或凭据。"
      };
    }
    return { status: "available", selectable: true, reason: "" };
  }
  if (provider === "local-model") {
    const hasUrl = Boolean(stringValue(entry.url || entry.baseUrl || settings.localModelEndpoint));
    if (!hasModel || !hasUrl) {
      return {
        status: "unconfigured",
        selectable: false,
        reason: "缺少本地模型名称或调用地址。"
      };
    }
    return { status: "available", selectable: true, reason: "" };
  }
  const providerCredentialConfigured =
    provider === "deepseek"
      ? Boolean(settings.deepSeekApiKeyConfigured || stringValue(settings.deepSeekApiKey) || entry.apiKeyConfigured || stringValue(entry.apiKey))
      : provider === "openrouter"
        ? Boolean(settings.openRouterApiKeyConfigured || stringValue(settings.openRouterApiKey) || entry.apiKeyConfigured || stringValue(entry.apiKey))
        : provider === "copilot"
          ? Boolean(settings.copilotApiKeyConfigured || stringValue(settings.copilotApiKey) || entry.apiKeyConfigured || stringValue(entry.apiKey))
          : Boolean(entry.apiKeyConfigured || stringValue(entry.apiKey || entry.token));
  if (!hasModel || !providerCredentialConfigured) {
    return {
      status: "unconfigured",
      selectable: false,
      reason: "缺少模型或凭据。"
    };
  }
  return { status: "available", selectable: true, reason: "" };
}

function buildAgentSelector(settings = {}) {
  const options = [];
  const seen = new Set();
  for (const entry of Array.isArray(settings.modelLibraryAgents) ? settings.modelLibraryAgents : []) {
    const agentUid = agentSelectorUid(entry);
    if (!agentUid || seen.has(agentUid)) {
      continue;
    }
    seen.add(agentUid);
    const state = agentSelectorStatus(settings, entry);
    options.push({
      agentUid,
      value: agentUid,
      label: agentSelectorLabel(entry, agentUid),
      provider: stringValue(entry.provider),
      model: stringValue(entry.model || entry.engine),
      permissionGroupId: stringValue(entry.permissionGroupId),
      moduleIds: agentSelectorModuleIds(entry),
      capabilities: state.selectable
        ? ["agent.invoke", "knowledge.agent.answer"]
        : [],
      status: state.status,
      selectable: state.selectable,
      reason: state.reason
    });
  }
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    source: "agent-configs",
    updatedAt: new Date().toISOString(),
    options
  };
}

function emptyAgentSettingsProjection(userDataPath = "") {
  return {
    settings: {
      path: getSettingsPath(userDataPath),
      value: {}
    },
    agentSelector: buildAgentSelector({}),
    agentConfigs: {
      rootPath: "",
      modelListPath: "",
      agentListPath: "",
      modelManifest: {},
      agentManifest: {}
    }
  };
}

function storageClientRegistrations(storageProvider = null, input = {}) {
  return typeof storageProvider?.listClientRegistrations === "function"
    ? storageProvider.listClientRegistrations(input)
    : { summary: {}, items: [] };
}

export async function buildAgentSettingsConsoleProjection({
  userDataPath,
  getAgentConfigRegistry = createFallbackAgentConfigRegistry
} = {}) {
  const [settings, rawSettings] = await Promise.all([
    loadSettings(userDataPath, { redactSecrets: true }),
    loadSettings(userDataPath)
  ]);
  const agentConfigRegistry =
    typeof getAgentConfigRegistry === "function"
      ? getAgentConfigRegistry()
      : createFallbackAgentConfigRegistry();
  if (!agentConfigRegistry || typeof agentConfigRegistry.refresh !== "function") {
    return emptyAgentSettingsProjection(userDataPath);
  }
  const agentConfigState = await agentConfigRegistry.refresh({ settingsFallback: rawSettings });
  const projectedSettings = {
    ...settings,
    modelLibraryEntries: typeof agentConfigRegistry.getModelLibraryEntries === "function"
      ? agentConfigRegistry.getModelLibraryEntries()
      : [],
    modelLibraryAgentIds: typeof agentConfigRegistry.getModelLibraryAgents === "function"
      ? agentConfigRegistry.getModelLibraryAgents().map((agent) => agent.uid).filter(Boolean)
      : [],
    modelLibraryAgents: typeof agentConfigRegistry.getModelLibraryAgents === "function"
      ? agentConfigRegistry.getModelLibraryAgents({ redactSecrets: true })
      : []
  };
  return {
    settings: {
      path: getSettingsPath(userDataPath),
      value: projectedSettings
    },
    agentSelector: buildAgentSelector(projectedSettings),
    agentConfigs: {
      rootPath: agentConfigState.rootPath,
      modelListPath: agentConfigState.modelListPath,
      agentListPath: agentConfigState.agentListPath,
      modelManifest: agentConfigState.modelManifest,
      agentManifest: agentConfigState.agentManifest
    }
  };
}

export async function buildRuntimeInfoSettings({ userDataPath } = {}) {
  return loadSettings(userDataPath, { redactSecrets: true });
}

export async function buildConsoleJobsSummary({
  jobWorkflowProvider = null,
  limit = 50
} = {}) {
  if (!jobWorkflowProvider || typeof jobWorkflowProvider.listJobs !== "function") {
    return { summary: {}, items: [] };
  }
  return jobWorkflowProvider.listJobs({ limit });
}

export async function buildConsoleClientConnections({
  storageProvider = null,
  offlineAfterSeconds = 0,
  toolSkillManagementProvider = null,
  buildToolManagementClientConnectionRows = null
} = {}) {
  const clientRegistrations = await Promise.resolve(storageClientRegistrations(storageProvider, {
    offlineAfterSeconds
  }));
  const additionalConnectionRows =
    typeof buildToolManagementClientConnectionRows === "function"
      ? await buildToolManagementClientConnectionRows(toolSkillManagementProvider, { offlineAfterSeconds })
      : [];
  return buildClientConnectionList(clientRegistrations, additionalConnectionRows);
}

export async function buildMaintenanceAgentConsoleSummary({ maintenanceAgent = null } = {}) {
  return maintenanceAgent && typeof maintenanceAgent.getConsoleSummary === "function"
    ? maintenanceAgent.getConsoleSummary()
    : null;
}

export async function buildClientRuntimeConsoleSummary({ clientRuntimeAllocator = null } = {}) {
  return clientRuntimeAllocator && typeof clientRuntimeAllocator.getStatus === "function"
    ? clientRuntimeAllocator.getStatus()
    : null;
}
