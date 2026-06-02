import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteJsonThroughState,
  mutateState,
  waitForStateIdle
} from "./state-coordinator.mjs";

const MODEL_PROVIDERS = new Set([
  "google-gemini",
  "openai-chatgpt",
  "deepseek",
  "openrouter",
  "copilot",
  "custom-http",
  "local-model"
]);
const MODEL_LIBRARY_PROVIDERS = new Set([
  "google-gemini",
  "openai-chatgpt",
  "deepseek",
  "openrouter",
  "copilot",
  "custom-http",
  "local-model"
]);
const DEFAULT_GOOGLE_MODEL =
  process.env.PACT_GOOGLE_MODEL || "gemini-flash-lite-latest";
const DEFAULT_OPENAI_MODEL = process.env.PACT_OPENAI_MODEL || "gpt-5.4-mini";
const DEFAULT_DEEPSEEK_MODEL =
  process.env.PACT_DEEPSEEK_MODEL || "deepseek-v4-pro";
const DEFAULT_MODEL_PROVIDER = process.env.PACT_DEFAULT_MODEL_PROVIDER || "";
const DEFAULT_MODEL = process.env.PACT_DEFAULT_MODEL || "";
const DEFAULT_AGENT_LOCAL_NODE_COMMAND = "node";
const AGENT_LOCAL_NODE_COMMAND_ENV_KEYS = [
  "PACT_AGENT_LOCAL_NODE_COMMAND",
  "PACT_NODE_COMMAND",
  "NODE_BINARY"
];
const DEFAULT_NODE_VERSION_VARIABLES = [
  {
    name: "flag",
    label: "Version flag",
    required: false,
    defaultValue: "--version",
    allowedValues: ["--version"],
    description: "Node.js version probe flag supplied by the agent through function-call variables."
  }
];
const DEFAULT_AGENT_TOOL_FUNCTION_CALL_SCHEMA = {
  http_request: {
    method: "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS",
    url: "http://127.0.0.1:7228/api/tool-management/v1/execute",
    headers: {},
    query: {},
    body: {},
    timeoutMs: 30000
  },
  local_command: {
    commandId: "node-version",
    variables: {
      flag: "--version"
    },
    args: [],
    cwd: "",
    stdin: "",
    timeoutMs: 30000
  }
};
const DEFAULT_CUSTOM_HTTP_ADAPTER = {
  alias:
    process.env.PACT_CUSTOM_HTTP_ADAPTER_ALIAS ||
    process.env.PACT_CUSTOM_MODEL_ALIAS ||
    "external-agent",
  url: process.env.PACT_CUSTOM_HTTP_ADAPTER_URL || "",
  token: process.env.PACT_CUSTOM_HTTP_ADAPTER_TOKEN || "",
  tokenHeader: process.env.PACT_CUSTOM_HTTP_ADAPTER_TOKEN_HEADER || "token",
  tokenPrefix: process.env.PACT_CUSTOM_HTTP_ADAPTER_TOKEN_PREFIX || "",
  agentName: process.env.PACT_CUSTOM_HTTP_ADAPTER_AGENT_NAME || "",
  pluginList: [],
  engine: process.env.PACT_CUSTOM_HTTP_ADAPTER_ENGINE || "",
  parameters: {},
  timeoutMs: Number(process.env.PACT_CUSTOM_HTTP_ADAPTER_TIMEOUT_MS || 120000)
};

const DEFAULT_AGENT_EXPLORE_DEFAULTS = {
  systemPrompt:
    "You are Pact Knowledge Explorer. You are stateless; use the supplied ContextPack as your only memory.",
  toolPolicyPrompt:
    "Always search from coarse to fine. For counts, totals, rankings, frequency, or 'which has the most' questions, first call knowledge_aggregate. For normal evidence recall, first call keyword_search with broad but meaningful keywords, then open_evidence only for promising evidenceId values.",
  continuationPrompt:
    "Continue from the tool results. Call another tool only if more local evidence is needed; otherwise give the final answer with evidenceId citations.",
  answerTemplate:
    [
      "默认使用以下 Markdown 报告格式输出，除非用户明确要求其他格式。必须保留分割线。",
      "如果用户问题不是风险分析，把“风险”自然替换成“发现 / 事项 / 结论”，但保留同样结构。",
      "",
      "根据对【分析范围】的分析，发现以下【数量】项【风险/发现】：",
      "",
      "---",
      "",
      "1. 【风险图标】 【标题】",
      "",
      "【一段可读说明：写清事实、时间、影响和风险。关键日期、金额、IP、账号、服务名称用加粗突出。不要编造证据中没有的信息。】",
      "",
      "📎 证据来源：evidence::xxxx, evidence::yyyy",
      "",
      "---",
      "",
      "2. 【风险图标】 【标题】",
      "",
      "【说明】",
      "",
      "📎 证据来源：evidence::zzzz",
      "",
      "---",
      "",
      "建议行动：",
      "",
      "- 【行动 1】",
      "- 【行动 2】",
      "- 【行动 3】",
      "",
      "要求：证据 ID 必须保持原样；不要写不存在的 evidenceId；证据不足时添加“不确定项”小节。"
    ].join("\n"),
  temperature: 0.2,
  maxTokens: 1800,
  maxIterations: 4,
  limit: 8,
  contextProfileId: "context-128k",
  thinkingMode: "default",
  toolChoice: "auto",
  infoFeedSummaryModelAlias: "",
  agentRetrievalModelAlias: "",
  ruleAuthoringModelAlias: "",
  reviewFusionModelAlias: "",
  reviewFusionSystemPrompt:
    "你是 Pact 知识冲突融合智能体。你只能基于输入的原始记录、新录入记录、冲突原因和证据字段进行分析。请判断两份知识是完全重合、部分重合还是明显不同；给出相似度、应采取的审核动作和可复核理由。不得改写原始证据，不得编造未提供的信息。",
  reviewFusionTemperature: 0.1,
  reviewFusionMaxTokens: 1200
};

const DEFAULT_AGENT_TOOL_EXECUTION = {
  functionCallSchema: DEFAULT_AGENT_TOOL_FUNCTION_CALL_SCHEMA,
  http: {
    enabled: true,
    allowedHosts: ["127.0.0.1", "localhost"],
    timeoutMs: 30000,
    maxResponseBytes: 65536
  },
  local: {
    enabled: true,
    allowDirectCommands: false,
    timeoutMs: 30000,
    maxOutputBytes: 65536,
    nodeCommand: "",
    commands: [
      {
        commandId: "node-version",
        label: "Node.js version",
        command: DEFAULT_AGENT_LOCAL_NODE_COMMAND,
        args: ["{{flag}}"],
        cwd: "",
        description: "Cross-platform Node runtime smoke command.",
        variables: DEFAULT_NODE_VERSION_VARIABLES,
        allowExtraArgs: false
      }
    ]
  }
};

export const MODEL_USAGE_DEFINITIONS = [
  {
    id: "knowledgeTaxonomy",
    label: "文档分类智能体",
    description: "邮件和文档进入知识图谱前的领域、关键词和意图分类。",
    requiresIntelligence: false
  },
  {
    id: "graphInsight",
    label: "知识图谱智能体",
    description: "节点聚合、关系解释和高频实体抽象。",
    requiresIntelligence: true
  },
  {
    id: "timelineDistillation",
    label: "时序提炼智能体",
    description: "围绕具体事务提炼阶段、事件和关键节点。",
    requiresIntelligence: true
  },
  {
    id: "agentTools",
    label: "智能体工具调用",
    description: "智能体可使用服务端工具的权限范围，不需要单独绑定智能体。",
    requiresIntelligence: false
  },
  {
    id: "localOcr",
    label: "本地 OCR",
    description: "本地 OCR 默认不需要大模型，只有开启多模态解释时才需要。",
    requiresIntelligence: false
  }
];

function defaultModuleIntelligence() {
  return Object.fromEntries(
    MODEL_USAGE_DEFINITIONS.map((item) => [item.id, item.requiresIntelligence])
  );
}

export const DEFAULT_SETTINGS = {
  tikaJarPath: process.env.PACT_TIKA_JAR_PATH || "",
  javaBinPath: process.env.PACT_JAVA_BIN_PATH || "",
  tikaTimeoutMs: (() => {
    const value = Number(process.env.PACT_TIKA_TIMEOUT_MS || 0);
    return Number.isFinite(value) && value > 0 ? value : 30 * 60 * 1000;
  })(),
  modelIntelligenceEnabled:
    process.env.PACT_MODEL_INTELLIGENCE_ENABLED === "1" ||
    process.env.PACT_GOOGLE_API_KEY
      ? true
      : false,
  googleApiKey: process.env.PACT_GOOGLE_API_KEY || "",
  googleModel: DEFAULT_GOOGLE_MODEL,
  openAiModel: DEFAULT_OPENAI_MODEL,
  defaultModelProvider: DEFAULT_MODEL_PROVIDER,
  defaultModel: DEFAULT_MODEL,
  modelLibraryEntries: [],
  modelLibraryAgentIds: [],
  modelLibraryAgents: [],
  agentPermissionGroups: [],
  agentExploreDefaults: DEFAULT_AGENT_EXPLORE_DEFAULTS,
  agentToolExecution: DEFAULT_AGENT_TOOL_EXECUTION,
  moduleModelAssignments: {},
  moduleAgentProfiles: {},
  moduleIntelligence: defaultModuleIntelligence(),
  openRouterApiKey: process.env.PACT_OPENROUTER_API_KEY || "",
  openRouterBaseUrl:
    process.env.PACT_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
  openRouterModel: process.env.PACT_OPENROUTER_MODEL || "openai/gpt-4.1-mini",
  deepSeekApiKey: process.env.PACT_DEEPSEEK_API_KEY || "",
  deepSeekBaseUrl: process.env.PACT_DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  deepSeekModel: DEFAULT_DEEPSEEK_MODEL,
  deepSeekTimeoutMs: Number(process.env.PACT_DEEPSEEK_TIMEOUT_MS || 120000),
  copilotEndpoint: process.env.PACT_COPILOT_ENDPOINT || "",
  copilotApiKey: process.env.PACT_COPILOT_API_KEY || "",
  copilotModel: process.env.PACT_COPILOT_MODEL || "copilot-default",
  localModelEndpoint: process.env.PACT_LOCAL_MODEL_ENDPOINT || "",
  localModelName: process.env.PACT_LOCAL_MODEL_NAME || "local-default",
  customModelAlias:
    process.env.PACT_CUSTOM_MODEL_ALIAS || DEFAULT_CUSTOM_HTTP_ADAPTER.alias,
  customModelLabel: process.env.PACT_CUSTOM_MODEL_LABEL || "自定义 HTTP 模型",
  customModelApiKey: process.env.PACT_CUSTOM_MODEL_API_KEY || "",
  customHttpAdapter: DEFAULT_CUSTOM_HTTP_ADAPTER,
  customHttpAdapters: [],
  analysisModuleId:
    process.env.PACT_ANALYSIS_MODULE_ID ||
    process.env.PACT_ANALYSIS_ALGORITHM ||
    "builtin:heuristic-hybrid-v1",
  ocrEnabled:
    process.env.PACT_OCR_ENABLED === undefined
      ? true
      : process.env.PACT_OCR_ENABLED !== "0",
  ocrPythonPath: process.env.PACT_OCR_PYTHON_PATH || "",
  ocrLanguage: process.env.PACT_PADDLEOCR_LANG || "ch",
  pdfVisualPythonPath: process.env.PACT_PDF_VISUAL_PYTHON_PATH || "",
  retrievalHalfLifeDays: Number(process.env.PACT_RETRIEVAL_HALF_LIFE_DAYS || 45),
  staleAfterDays: Number(process.env.PACT_STALE_AFTER_DAYS || 180),
  transactionWindowDays: Number(process.env.PACT_TRANSACTION_WINDOW_DAYS || 30)
};

export function getSettingsPath(userDataPath) {
  return path.join(userDataPath, "settings.json");
}

export function getModelSettingsDirectory(userDataPath) {
  return path.join(userDataPath, "model-settings");
}

export function getModelAgentSettingsDirectory(userDataPath) {
  return path.join(userDataPath, "model-agents");
}

export function getAgentToolSettingsDirectory(userDataPath) {
  return path.join(userDataPath, "tool-management");
}

export function getAgentToolExecutionSettingsPath(userDataPath) {
  return path.join(getAgentToolSettingsDirectory(userDataPath), "execution.json");
}

export function getModelProviderSettingsPath(userDataPath, provider) {
  const normalizedProvider = String(provider || "").trim();
  if (!MODEL_LIBRARY_PROVIDERS.has(normalizedProvider)) {
    throw new Error(`不支持的模型配置类型：${normalizedProvider || "unknown"}`);
  }
  return path.join(getModelSettingsDirectory(userDataPath), `${normalizedProvider}.json`);
}

export function getModelAgentSettingsPath(userDataPath, agentId) {
  const normalizedAgentId = safeModelAgentFileId(agentId);
  if (!normalizedAgentId) {
    throw new Error("模型智能体 UID 为空，不能写入独立配置文件。");
  }
  return path.join(getModelAgentSettingsDirectory(userDataPath), `${normalizedAgentId}.json`);
}

const MODEL_PROVIDER_SETTING_KEYS = {
  "google-gemini": [
    "googleApiKey",
    "googleApiKeyConfigured",
    "googleModel"
  ],
  "openai-chatgpt": [
    "openAiModel"
  ],
  openrouter: [
    "openRouterApiKey",
    "openRouterApiKeyConfigured",
    "openRouterBaseUrl",
    "openRouterModel"
  ],
  deepseek: [
    "deepSeekApiKey",
    "deepSeekApiKeyConfigured",
    "deepSeekBaseUrl",
    "deepSeekModel",
    "deepSeekTimeoutMs"
  ],
  copilot: [
    "copilotEndpoint",
    "copilotApiKey",
    "copilotApiKeyConfigured",
    "copilotModel"
  ],
  "local-model": [
    "localModelEndpoint",
    "localModelName"
  ],
  "custom-http": [
    "customModelAlias",
    "customModelLabel",
    "customModelApiKey",
    "customModelApiKeyConfigured",
    "customHttpAdapter",
    "customHttpAdapters"
  ]
};

function sanitizeNumericSetting(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeModelProvider(value, fallback = "google-gemini") {
  const normalized = String(value || "").trim();
  if (MODEL_PROVIDERS.has(normalized)) {
    return normalized;
  }
  return MODEL_PROVIDERS.has(fallback) ? fallback : "";
}

function normalizeModelLibraryEntries(value, settings = {}) {
  const incoming = Array.isArray(value) ? value : [];
  const normalized = [];
  const seen = new Set();
  const add = (provider) => {
    const item = String(provider || "").trim();
    if (!MODEL_LIBRARY_PROVIDERS.has(item) || seen.has(item)) {
      return;
    }
    seen.add(item);
    normalized.push(item);
  };

  for (const item of incoming) {
    add(item);
  }

  if (incoming.length === 0 && !Object.hasOwn(settings || {}, "modelLibraryEntries")) {
    for (const model of Array.isArray(settings?.modelLibraryAgents)
      ? settings.modelLibraryAgents
      : []) {
      add(model?.provider);
    }
    const customHttpInput = normalizePlainObject(settings?.customHttpAdapter);
    if (
      String(customHttpInput.url || customHttpInput.endpoint || "").trim() ||
      String(customHttpInput.token || customHttpInput.apiKey || settings?.customModelApiKey || "").trim() ||
      String(customHttpInput.engine || customHttpInput.model || "").trim()
    ) {
      add("custom-http");
    }
  }

  return normalized;
}

function inferModelProvider(model) {
  const normalized = String(model || "").trim().toLowerCase();
  if (
    normalized.startsWith("gpt-") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4")
  ) {
    return "openai-chatgpt";
  }
  if (normalized.startsWith("gemini-")) {
    return "google-gemini";
  }
  if (normalized.startsWith("openrouter:") || normalized.includes("/")) {
    return "openrouter";
  }
  if (normalized.startsWith("deepseek-")) {
    return "deepseek";
  }
  if (normalized.startsWith("copilot")) {
    return "copilot";
  }
  if (normalized.startsWith("local")) {
    return "local-model";
  }
  return "";
}

function defaultModelForProvider(provider, fallbackModel, providerDefaults = {}) {
  const providerDefault = String(providerDefaults[provider] || "").trim();
  return providerDefault || fallbackModel;
}

function normalizeModelAssignment(value) {
  if (typeof value === "string") {
    const [providerPart, ...modelParts] = value.split(":");
    const providerInput = String(providerPart || "").trim();
    const provider = MODEL_PROVIDERS.has(providerInput) ? providerInput : "";
    const model = modelParts.join(":").trim();
    if (!provider || !model) {
      return null;
    }
    return {
      provider,
      model
    };
  }

  if (value && typeof value === "object") {
    const providerInput = String(value.provider || inferModelProvider(value.model) || "").trim();
    const provider = MODEL_PROVIDERS.has(providerInput) ? providerInput : "";
    const model = String(value.model || "").trim();
    if (!provider || !model) {
      return null;
    }
    return {
      provider,
      model
    };
  }

  return null;
}

function normalizeAgentModuleAccess(value = {}) {
  const incoming = normalizePlainObject(value);
  const mode = String(incoming.mode || incoming.scope || "").trim();
  const moduleIds = normalizeStringList(
    incoming.moduleIds || incoming.modules || incoming.allowedModuleIds
  ).filter((item) => MODEL_USAGE_DEFINITIONS.some((definition) => definition.id === item));
  if (mode === "selected" || mode === "restricted") {
    return {
      mode: "selected",
      moduleIds: [...new Set(moduleIds)]
    };
  }
  return {
    mode: "all",
    moduleIds: []
  };
}

function normalizeAgentPermissionGroup(value = {}, index = 0) {
  const incoming = normalizePlainObject(value);
  const id =
    String(incoming.id || incoming.groupId || incoming.permissionGroupId || "").trim() ||
    `agent-permission-${index + 1}`;
  return {
    id,
    label: String(incoming.label || incoming.name || id).trim(),
    description: String(incoming.description || "").trim(),
    enabled: incoming.enabled !== false,
    scopeIds: [...new Set(normalizeStringList(incoming.scopeIds || incoming.scopes))],
    toolsetIds: [...new Set(normalizeStringList(incoming.toolsetIds || incoming.toolsets))],
    toolAllow: [...new Set(normalizeStringList(incoming.toolAllow || incoming.allowTools))],
    toolDeny: [...new Set(normalizeStringList(incoming.toolDeny || incoming.denyTools))]
  };
}

function normalizeAgentPermissionGroups(value = []) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((item, index) => normalizeAgentPermissionGroup(item, index))
    .filter((item) => {
      if (!item.id || seen.has(item.id)) {
        return false;
      }
      seen.add(item.id);
      return true;
    });
}

function modelLibraryAgentIdentities(model = {}) {
  return [model.uid, model.instanceId, model.alias]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function modelLibraryAgentId(model = {}) {
  return String(model.uid || model.instanceId || model.alias || "").trim();
}

function modelAllowsModule(model = {}, moduleId = "") {
  const access = normalizeAgentModuleAccess(model.moduleAccess);
  if (access.mode !== "selected") {
    return true;
  }
  return access.moduleIds.includes(moduleId);
}

function resolveModuleModelAssignmentToAgent(assignment, modelLibraryAgents = [], moduleId = "") {
  if (!assignment) {
    return null;
  }
  const provider = String(assignment.provider || "").trim();
  const model = String(assignment.model || "").trim();
  if (!provider || !model) {
    return null;
  }
  const providerModels = modelLibraryAgents.filter(
    (item) => String(item?.provider || "").trim() === provider
  );
  const directMatch = providerModels.find((item) =>
    modelLibraryAgentIdentities(item).includes(model) && modelAllowsModule(item, moduleId)
  );
  if (directMatch) {
    return {
      provider,
      model: modelLibraryAgentId(directMatch)
    };
  }

  const modelIdMatches = providerModels.filter((item) =>
    [item.model, item.engine]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .includes(model) && modelAllowsModule(item, moduleId)
  );
  if (modelIdMatches.length === 1) {
    return {
      provider,
      model: modelLibraryAgentId(modelIdMatches[0])
    };
  }

  if (providerModels.some((item) => modelAllowsModule(item, moduleId)) && provider !== "custom-http") {
    return null;
  }

  return assignment;
}

function normalizeModuleModelAssignments(
  assignments,
  modelLibraryAgents = [],
) {
  const normalized = {};
  const incoming = assignments && typeof assignments === "object" ? assignments : {};
  const models = Array.isArray(modelLibraryAgents) ? modelLibraryAgents : [];

  for (const definition of MODEL_USAGE_DEFINITIONS) {
    const assignment = normalizeModelAssignment(
      incoming[definition.id]
    );
    const resolved = resolveModuleModelAssignmentToAgent(assignment, models, definition.id);
    if (resolved) {
      normalized[definition.id] = resolved;
    }
  }

  return normalized;
}

function normalizeModuleAgentProfile(value = {}) {
  const incoming = normalizePlainObject(value);
  return {
    enabled: incoming.enabled !== false,
    role: String(incoming.role || incoming.roleId || "primary").trim() || "primary",
    contextProfileId: String(incoming.contextProfileId || incoming.profileId || "").trim(),
    systemPrompt: String(incoming.systemPrompt || incoming.prompt || "").trim(),
    parameters: normalizePlainObject(incoming.parameters, {}),
    dependencyContext: normalizePlainObject(incoming.dependencyContext || incoming.dependencies, {})
  };
}

function normalizeModuleAgentProfiles(value = {}, modelLibraryAgents = [], moduleModelAssignments = {}) {
  const incoming = normalizePlainObject(value);
  const normalized = {};
  const modelsById = new Map(
    (Array.isArray(modelLibraryAgents) ? modelLibraryAgents : [])
      .map((model) => [modelLibraryAgentId(model), model])
      .filter(([id]) => id)
  );

  for (const definition of MODEL_USAGE_DEFINITIONS) {
    const moduleId = definition.id;
    const group = normalizePlainObject(incoming[moduleId]);
    const agents = {};
    const incomingAgents = normalizePlainObject(group.agents);
    for (const [agentId, profile] of Object.entries(incomingAgents)) {
      const normalizedAgentId = String(agentId || "").trim();
      const model = modelsById.get(normalizedAgentId);
      if (!model || !modelAllowsModule(model, moduleId)) {
        continue;
      }
      agents[normalizedAgentId] = normalizeModuleAgentProfile(profile);
    }

    const assignment = moduleModelAssignments[moduleId];
    const primaryAgent = String(group.primaryAgent || assignment?.model || "").trim();
    if (primaryAgent && modelsById.has(primaryAgent) && modelAllowsModule(modelsById.get(primaryAgent), moduleId)) {
      agents[primaryAgent] = {
        ...normalizeModuleAgentProfile({ role: "primary" }),
        ...(agents[primaryAgent] || {})
      };
    }

    if (Object.keys(agents).length > 0 || primaryAgent) {
      normalized[moduleId] = {
        primaryAgent: agents[primaryAgent] ? primaryAgent : "",
        agents
      };
    }
  }

  return normalized;
}

function normalizeModuleIntelligence(moduleIntelligence, moduleModelAssignments = {}) {
  const defaults = defaultModuleIntelligence();
  const incoming =
    moduleIntelligence && typeof moduleIntelligence === "object" ? moduleIntelligence : {};

  return Object.fromEntries(
    MODEL_USAGE_DEFINITIONS.map((definition) => {
      const hasAssignment = Boolean(moduleModelAssignments?.[definition.id]);
      return [
        definition.id,
        hasAssignment
          ? true
          : incoming[definition.id] === undefined
            ? defaults[definition.id]
            : incoming[definition.id] !== false
      ];
    })
  );
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizePlainObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function firstEnvironmentValue(keys = []) {
  for (const key of keys) {
    const value = String(process.env[key] || "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function resolveAgentLocalNodeCommandOverride(local = {}) {
  const configuredNodeCommand = String(local.nodeCommand || local.nodePath || "").trim();
  return firstEnvironmentValue(AGENT_LOCAL_NODE_COMMAND_ENV_KEYS) || configuredNodeCommand;
}

function shouldResolveBuiltInNodeCommand(commandId, command, hasNodeCommandOverride) {
  if (String(commandId || "").trim() !== "node-version") {
    return false;
  }
  if (hasNodeCommandOverride) {
    return true;
  }
  const normalizedCommand = String(command || "").trim();
  if (!normalizedCommand) {
    return true;
  }
  if (normalizedCommand === DEFAULT_AGENT_LOCAL_NODE_COMMAND) {
    return false;
  }
  return normalizedCommand === process.execPath || path.isAbsolute(normalizedCommand);
}

function normalizeAgentLocalCommandVariables(value) {
  const variables = Array.isArray(value) ? value : [];
  return variables
    .map((item) => {
      const variable = normalizePlainObject(item);
      const name = String(variable.name || variable.key || "").trim();
      if (!name) {
        return null;
      }
      const hasDefault = Object.hasOwn(variable, "defaultValue") || Object.hasOwn(variable, "default");
      return {
        name,
        label: String(variable.label || variable.title || name).trim(),
        required: variable.required === true,
        ...(hasDefault
          ? { defaultValue: String(variable.defaultValue ?? variable.default ?? "") }
          : {}),
        allowedValues: normalizeStringList(variable.allowedValues || variable.enum || variable.options),
        description: String(variable.description || variable.help || "").trim()
      };
    })
    .filter(Boolean);
}

function normalizeAgentLocalCommandTemplate(
  command,
  index,
  resolvedNodeCommand,
  hasNodeCommandOverride
) {
  const commandId = String(command.commandId || command.id || `command-${index + 1}`).trim();
  const commandValue = String(command.command || "").trim();
  const isBuiltInNodeVersion = commandId === "node-version";
  const variables = normalizeAgentLocalCommandVariables(
    isBuiltInNodeVersion ? command.variables || DEFAULT_NODE_VERSION_VARIABLES : command.variables
  );
  const rawArgs = normalizeStringList(command.args);
  const usesTemplateVariables = variables.length > 0;
  return {
    commandId,
    label: String(command.label || command.name || command.commandId || `Command ${index + 1}`).trim(),
    command: shouldResolveBuiltInNodeCommand(commandId, commandValue, hasNodeCommandOverride)
      ? resolvedNodeCommand
      : commandValue,
    args: isBuiltInNodeVersion && !rawArgs.some((arg) => /\{\{\s*flag\s*\}\}/.test(arg))
      ? ["{{flag}}"]
      : rawArgs,
    cwd: String(command.cwd || "").trim(),
    description: String(command.description || "").trim(),
    variables,
    allowExtraArgs: Object.hasOwn(command, "allowExtraArgs")
      ? command.allowExtraArgs === true
      : !usesTemplateVariables
  };
}

function defaultAgentLocalCommandTemplates(resolvedNodeCommand, hasNodeCommandOverride) {
  return DEFAULT_AGENT_TOOL_EXECUTION.local.commands.map((command, index) =>
    normalizeAgentLocalCommandTemplate(command, index, resolvedNodeCommand, hasNodeCommandOverride)
  );
}

function safeModelAgentFileId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function readPresentString(source = {}, keys = []) {
  const value = normalizePlainObject(source);
  for (const key of keys) {
    if (Object.hasOwn(value, key)) {
      return String(value[key] ?? "").trim();
    }
  }
  return undefined;
}

function normalizeCustomHttpAdapter(value = {}, fallbacks = {}) {
  const incoming = normalizePlainObject(value);
  const timeoutMs = Number(incoming.timeoutMs || DEFAULT_CUSTOM_HTTP_ADAPTER.timeoutMs);
  const alias =
    String(
      incoming.alias ||
        incoming.modelAlias ||
        fallbacks.alias ||
        DEFAULT_CUSTOM_HTTP_ADAPTER.alias ||
        ""
    ).trim() || DEFAULT_CUSTOM_HTTP_ADAPTER.alias;
  return {
    alias,
    label:
      String(
        incoming.label ||
          fallbacks.label ||
          DEFAULT_SETTINGS.customModelLabel ||
          "自定义 HTTP 模型"
      ).trim() || "自定义 HTTP 模型",
    url: String(incoming.url || incoming.endpoint || DEFAULT_CUSTOM_HTTP_ADAPTER.url || "").trim(),
    token: String(
      incoming.token ||
        incoming.apiKey ||
        fallbacks.token ||
        DEFAULT_CUSTOM_HTTP_ADAPTER.token ||
        ""
    ).trim(),
    tokenHeader:
      String(incoming.tokenHeader || DEFAULT_CUSTOM_HTTP_ADAPTER.tokenHeader || "token").trim() ||
      "token",
    tokenPrefix: String(incoming.tokenPrefix ?? DEFAULT_CUSTOM_HTTP_ADAPTER.tokenPrefix ?? ""),
    agentName:
      readPresentString(incoming, ["agentName"]) ??
      String(DEFAULT_CUSTOM_HTTP_ADAPTER.agentName || "").trim(),
    pluginList: normalizeStringList(incoming.pluginList || DEFAULT_CUSTOM_HTTP_ADAPTER.pluginList),
    engine: String(incoming.engine || DEFAULT_CUSTOM_HTTP_ADAPTER.engine || "").trim(),
    parameters: normalizePlainObject(incoming.parameters, {}),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000
  };
}

function normalizeCustomHttpAdapterList(primaryAdapter, settings = {}, fallbacks = {}) {
  const normalized = [];
  const seen = new Set();
  const addAdapter = (value, adapterFallbacks = {}) => {
    const adapter = normalizeCustomHttpAdapter(value, adapterFallbacks);
    if (!adapter.alias || seen.has(adapter.alias)) {
      return;
    }
    seen.add(adapter.alias);
    normalized.push(adapter);
  };
  addAdapter(primaryAdapter, fallbacks);
  for (const item of Array.isArray(settings?.customHttpAdapters)
    ? settings.customHttpAdapters
    : []) {
    addAdapter(item);
  }
  return normalized;
}

function stableAgentUid(...parts) {
  const base = parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n");
  const digest = crypto
    .createHash("sha256")
    .update(base || crypto.randomUUID())
    .digest("hex")
    .slice(0, 16);
  return `agent_${digest}`;
}

function normalizeModelLibraryAgent(value = {}, index = 0, settings = {}) {
  const incoming = normalizePlainObject(value);
  const provider = normalizeModelProvider(
    incoming.provider || incoming.modelProvider || "",
    ""
  );
  const model =
    readPresentString(incoming, ["model", "modelId", "engine"]) ?? "";
  const label =
    readPresentString(incoming, ["label", "name", "agentName"]) ??
    (String(incoming.alias || "").trim() || `${provider}${model ? ` ${model}` : " agent"}`.trim());
  const agentName =
    readPresentString(incoming, ["agentName", "label", "name"]) ?? label;
  const engine = readPresentString(incoming, ["engine", "model", "modelId"]) ?? "";
  const existingInstanceId = String(incoming.instanceId || incoming.id || "").trim();
  const explicitUid = String(incoming.uid || "").trim();
  const existingAlias = String(incoming.alias || incoming.modelAlias || "").trim();
  const uid =
    explicitUid ||
    (existingInstanceId.startsWith("agent_") ? existingInstanceId : "") ||
    (existingAlias.startsWith("agent_") ? existingAlias : "") ||
    stableAgentUid(provider, existingInstanceId || existingAlias || index + 1);
  const alias = uid;
  const timeoutMs = Number(
    incoming.timeoutMs ||
      (provider === "deepseek" ? settings.deepSeekTimeoutMs : undefined) ||
      DEFAULT_CUSTOM_HTTP_ADAPTER.timeoutMs
  );
  return {
    uid,
    instanceId: uid,
    provider,
    alias,
    label,
    baseUrl: String(
      incoming.baseUrl ||
        incoming.url ||
        (provider === "deepseek" ? settings.deepSeekBaseUrl : "") ||
        ""
    ).trim(),
    url: String(incoming.url || "").trim(),
    model,
    apiKey: String(
      incoming.apiKey ||
        incoming.token ||
        ""
    ).trim(),
    apiKeyConfigured: incoming.apiKeyConfigured === true,
    token: String(incoming.token || incoming.apiKey || "").trim(),
    tokenConfigured: incoming.tokenConfigured === true,
    tokenHeader: String(incoming.tokenHeader || DEFAULT_CUSTOM_HTTP_ADAPTER.tokenHeader || "token").trim() || "token",
    tokenPrefix: String(incoming.tokenPrefix ?? DEFAULT_CUSTOM_HTTP_ADAPTER.tokenPrefix ?? ""),
    agentName,
    engine,
    pluginList: normalizeStringList(incoming.pluginList),
    systemPrompt: String(incoming.systemPrompt || incoming.prompt || "").trim(),
    parameters: normalizePlainObject(incoming.parameters, {}),
    moduleAccess: normalizeAgentModuleAccess(incoming.moduleAccess),
    permissionGroupId: String(incoming.permissionGroupId || "").trim(),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000
  };
}

function normalizeModelLibraryAgents(value = [], settings = {}) {
  const input = Array.isArray(value) ? value : [];
  const normalized = input
    .map((item, index) => normalizeModelLibraryAgent(item, index, settings))
    .filter((item) => item.provider && item.alias);
  return normalized;
}

function normalizeAgentExploreDefaults(value = {}) {
  const incoming = normalizePlainObject(value);
  const thinkingMode = String(incoming.thinkingMode || DEFAULT_AGENT_EXPLORE_DEFAULTS.thinkingMode).trim();
  return {
    ...DEFAULT_AGENT_EXPLORE_DEFAULTS,
    ...incoming,
    systemPrompt: String(incoming.systemPrompt || DEFAULT_AGENT_EXPLORE_DEFAULTS.systemPrompt).trim(),
    toolPolicyPrompt: String(incoming.toolPolicyPrompt || DEFAULT_AGENT_EXPLORE_DEFAULTS.toolPolicyPrompt).trim(),
    continuationPrompt: String(incoming.continuationPrompt || DEFAULT_AGENT_EXPLORE_DEFAULTS.continuationPrompt).trim(),
    answerTemplate: String(incoming.answerTemplate || DEFAULT_AGENT_EXPLORE_DEFAULTS.answerTemplate).trim(),
    contextProfileId:
      String(incoming.contextProfileId || DEFAULT_AGENT_EXPLORE_DEFAULTS.contextProfileId).trim() ||
      DEFAULT_AGENT_EXPLORE_DEFAULTS.contextProfileId,
    thinkingMode: ["enabled", "disabled", "default"].includes(thinkingMode) ? thinkingMode : "default",
    temperature: sanitizeNumericSetting(
      incoming.temperature,
      DEFAULT_AGENT_EXPLORE_DEFAULTS.temperature
    ),
    maxTokens: sanitizeNumericSetting(
      incoming.maxTokens,
      DEFAULT_AGENT_EXPLORE_DEFAULTS.maxTokens
    ),
    maxIterations: sanitizeNumericSetting(
      incoming.maxIterations,
      DEFAULT_AGENT_EXPLORE_DEFAULTS.maxIterations
    ),
    limit: sanitizeNumericSetting(incoming.limit, DEFAULT_AGENT_EXPLORE_DEFAULTS.limit),
    toolChoice: String(incoming.toolChoice || DEFAULT_AGENT_EXPLORE_DEFAULTS.toolChoice).trim() || "auto",
    infoFeedSummaryModelAlias: String(
      incoming.infoFeedSummaryModelAlias || DEFAULT_AGENT_EXPLORE_DEFAULTS.infoFeedSummaryModelAlias
    ).trim(),
    agentRetrievalModelAlias: String(
      incoming.agentRetrievalModelAlias || DEFAULT_AGENT_EXPLORE_DEFAULTS.agentRetrievalModelAlias
    ).trim(),
    ruleAuthoringModelAlias: String(
      incoming.ruleAuthoringModelAlias || DEFAULT_AGENT_EXPLORE_DEFAULTS.ruleAuthoringModelAlias
    ).trim(),
    reviewFusionModelAlias: String(
      incoming.reviewFusionModelAlias || DEFAULT_AGENT_EXPLORE_DEFAULTS.reviewFusionModelAlias
    ).trim(),
    reviewFusionSystemPrompt: String(
      incoming.reviewFusionSystemPrompt || DEFAULT_AGENT_EXPLORE_DEFAULTS.reviewFusionSystemPrompt
    ).trim(),
    reviewFusionTemperature: sanitizeNumericSetting(
      incoming.reviewFusionTemperature,
      DEFAULT_AGENT_EXPLORE_DEFAULTS.reviewFusionTemperature
    ),
    reviewFusionMaxTokens: sanitizeNumericSetting(
      incoming.reviewFusionMaxTokens,
      DEFAULT_AGENT_EXPLORE_DEFAULTS.reviewFusionMaxTokens
    )
  };
}

function normalizeAgentToolExecution(value = {}) {
  const incoming = normalizePlainObject(value);
  const http = normalizePlainObject(incoming.http);
  const local = normalizePlainObject(incoming.local);
  const configuredNodeCommand = String(local.nodeCommand || local.nodePath || "").trim();
  const nodeCommandOverride = resolveAgentLocalNodeCommandOverride(local);
  const resolvedNodeCommand = nodeCommandOverride || DEFAULT_AGENT_LOCAL_NODE_COMMAND;
  const hasNodeCommandOverride = Boolean(nodeCommandOverride);
  const httpTimeoutMs = Number(http.timeoutMs || DEFAULT_AGENT_TOOL_EXECUTION.http.timeoutMs);
  const maxResponseBytes = Number(http.maxResponseBytes || DEFAULT_AGENT_TOOL_EXECUTION.http.maxResponseBytes);
  const localTimeoutMs = Number(local.timeoutMs || DEFAULT_AGENT_TOOL_EXECUTION.local.timeoutMs);
  const maxOutputBytes = Number(local.maxOutputBytes || DEFAULT_AGENT_TOOL_EXECUTION.local.maxOutputBytes);
  return {
    functionCallSchema: normalizePlainObject(
      incoming.functionCallSchema,
      DEFAULT_AGENT_TOOL_EXECUTION.functionCallSchema
    ),
    http: {
      ...DEFAULT_AGENT_TOOL_EXECUTION.http,
      ...http,
      enabled: http.enabled !== false,
      allowedHosts: normalizeStringList(http.allowedHosts || DEFAULT_AGENT_TOOL_EXECUTION.http.allowedHosts),
      timeoutMs: Number.isFinite(httpTimeoutMs) && httpTimeoutMs > 0 ? httpTimeoutMs : 30000,
      maxResponseBytes: Number.isFinite(maxResponseBytes) && maxResponseBytes > 0 ? maxResponseBytes : 65536
    },
    local: {
      ...DEFAULT_AGENT_TOOL_EXECUTION.local,
      ...local,
      enabled: local.enabled !== false,
      allowDirectCommands: false,
      timeoutMs: Number.isFinite(localTimeoutMs) && localTimeoutMs > 0 ? localTimeoutMs : 30000,
      maxOutputBytes: Number.isFinite(maxOutputBytes) && maxOutputBytes > 0 ? maxOutputBytes : 65536,
      nodeCommand: configuredNodeCommand,
      commands: Array.isArray(local.commands)
        ? local.commands.map((item, index) =>
            normalizeAgentLocalCommandTemplate(
              normalizePlainObject(item),
              index,
              resolvedNodeCommand,
              hasNodeCommandOverride
            )
          ).filter((item) => item.commandId && item.command)
        : defaultAgentLocalCommandTemplates(resolvedNodeCommand, hasNodeCommandOverride)
    }
  };
}

export function normalizeSettings(settings) {
  const incomingSettings = { ...(settings || {}) };
  for (const key of [
    "cloud" + "ParsingEnabled",
    "cloud" + "ParsingProvider",
    "cloud" + "ParsingMaxSources",
    "cloud" + "ParsingMaxChars",
    "cloud" + "ParsingHttpHead",
    "cloud" + "ParsingHttpBody"
  ]) {
    delete incomingSettings[key];
  }
  const normalizedApiKey = String(settings?.googleApiKey || DEFAULT_SETTINGS.googleApiKey || "").trim();
  let googleModel =
    String(settings?.googleModel || DEFAULT_SETTINGS.googleModel || "").trim() ||
    DEFAULT_SETTINGS.googleModel;
  let openAiModel =
    String(settings?.openAiModel || DEFAULT_SETTINGS.openAiModel || "").trim() ||
    DEFAULT_SETTINGS.openAiModel;
  const openRouterModel =
    String(settings?.openRouterModel || DEFAULT_SETTINGS.openRouterModel || "").trim() ||
    DEFAULT_SETTINGS.openRouterModel;
  let deepSeekModel =
    String(settings?.deepSeekModel || DEFAULT_SETTINGS.deepSeekModel || "").trim() ||
    DEFAULT_SETTINGS.deepSeekModel;
  const copilotModel =
    String(settings?.copilotModel || DEFAULT_SETTINGS.copilotModel || "").trim() ||
    DEFAULT_SETTINGS.copilotModel;
  const localModelName =
    String(settings?.localModelName || DEFAULT_SETTINGS.localModelName || "").trim() ||
    DEFAULT_SETTINGS.localModelName;
  const customModelLabel =
    String(settings?.customModelLabel || DEFAULT_SETTINGS.customModelLabel || "").trim() ||
    DEFAULT_SETTINGS.customModelLabel;
  const customHttpInput = normalizePlainObject(settings?.customHttpAdapter);
  const customModelAlias =
    String(
      settings?.customModelAlias ||
        customHttpInput.alias ||
        customHttpInput.modelAlias ||
        DEFAULT_SETTINGS.customModelAlias ||
        ""
    ).trim() || DEFAULT_SETTINGS.customModelAlias;
  const customHttpAdapter = normalizeCustomHttpAdapter(customHttpInput, {
    alias: customModelAlias,
    label: customModelLabel,
    token: settings?.customModelApiKey
  });
  const customHttpAdapters = normalizeCustomHttpAdapterList(customHttpInput, settings, {
    alias: customModelAlias,
    label: customModelLabel,
    token: settings?.customModelApiKey
  });
  const primaryCustomHttpAdapter = customHttpAdapters[0] || customHttpAdapter;
  const incomingDefaultModel = String(settings?.defaultModel || "").trim();
  const defaultModelProvider = normalizeModelProvider(
    settings?.defaultModelProvider ||
      inferModelProvider(incomingDefaultModel) ||
      DEFAULT_SETTINGS.defaultModelProvider,
    DEFAULT_SETTINGS.defaultModelProvider
  );
  const defaultModel = incomingDefaultModel || DEFAULT_SETTINGS.defaultModel;

  const modelLibraryAgents = normalizeModelLibraryAgents(settings?.modelLibraryAgents, {
    ...settings,
    deepSeekModel,
    deepSeekBaseUrl: settings?.deepSeekBaseUrl || DEFAULT_SETTINGS.deepSeekBaseUrl,
    deepSeekApiKey: settings?.deepSeekApiKey || DEFAULT_SETTINGS.deepSeekApiKey,
    deepSeekTimeoutMs: settings?.deepSeekTimeoutMs || DEFAULT_SETTINGS.deepSeekTimeoutMs
  });
  const moduleModelAssignments = normalizeModuleModelAssignments(
    settings?.moduleModelAssignments,
    modelLibraryAgents
  );
  const moduleAgentProfiles = normalizeModuleAgentProfiles(
    settings?.moduleAgentProfiles,
    modelLibraryAgents,
    moduleModelAssignments
  );
  const moduleIntelligence = normalizeModuleIntelligence(
    settings?.moduleIntelligence,
    moduleModelAssignments
  );

  return {
    ...DEFAULT_SETTINGS,
    ...incomingSettings,
    analysisModuleId:
      String(
        settings?.analysisModuleId ||
          settings?.analysisAlgorithmId ||
          DEFAULT_SETTINGS.analysisModuleId ||
          ""
      ).trim() || DEFAULT_SETTINGS.analysisModuleId,
    modelIntelligenceEnabled:
      settings?.modelIntelligenceEnabled === undefined
        ? DEFAULT_SETTINGS.modelIntelligenceEnabled
        : settings.modelIntelligenceEnabled !== false,
    googleApiKey: normalizedApiKey,
    googleModel,
    openAiModel,
    defaultModelProvider,
    defaultModel,
    modelLibraryEntries: normalizeModelLibraryEntries(settings?.modelLibraryEntries, settings),
    tikaTimeoutMs: sanitizeNumericSetting(
      settings?.tikaTimeoutMs,
      DEFAULT_SETTINGS.tikaTimeoutMs
    ),
    modelLibraryAgentIds: modelLibraryAgents.map((model) => modelAgentId(model)).filter(Boolean),
    modelLibraryAgents,
    agentPermissionGroups: normalizeAgentPermissionGroups(settings?.agentPermissionGroups),
    agentExploreDefaults: normalizeAgentExploreDefaults(settings?.agentExploreDefaults),
    agentToolExecution: normalizeAgentToolExecution(settings?.agentToolExecution),
    moduleModelAssignments,
    moduleAgentProfiles,
    moduleIntelligence,
    openRouterApiKey: String(
      settings?.openRouterApiKey || DEFAULT_SETTINGS.openRouterApiKey || ""
    ).trim(),
    openRouterBaseUrl:
      String(settings?.openRouterBaseUrl || DEFAULT_SETTINGS.openRouterBaseUrl || "").trim() ||
      DEFAULT_SETTINGS.openRouterBaseUrl,
    openRouterModel,
    deepSeekApiKey: String(
      settings?.deepSeekApiKey || DEFAULT_SETTINGS.deepSeekApiKey || ""
    ).trim(),
    deepSeekBaseUrl:
      String(settings?.deepSeekBaseUrl || DEFAULT_SETTINGS.deepSeekBaseUrl || "").trim() ||
      DEFAULT_SETTINGS.deepSeekBaseUrl,
    deepSeekModel,
    deepSeekTimeoutMs: sanitizeNumericSetting(
      settings?.deepSeekTimeoutMs,
      DEFAULT_SETTINGS.deepSeekTimeoutMs
    ),
    copilotEndpoint: String(settings?.copilotEndpoint || DEFAULT_SETTINGS.copilotEndpoint || ""),
    copilotApiKey: String(settings?.copilotApiKey || DEFAULT_SETTINGS.copilotApiKey || "").trim(),
    copilotModel,
    localModelEndpoint: String(
      settings?.localModelEndpoint || DEFAULT_SETTINGS.localModelEndpoint || ""
    ),
    localModelName,
    customModelAlias,
    customModelLabel,
    customModelApiKey: String(
      settings?.customModelApiKey || DEFAULT_SETTINGS.customModelApiKey || ""
    ).trim(),
    customHttpAdapter: primaryCustomHttpAdapter,
    customHttpAdapters,
    ocrEnabled: settings?.ocrEnabled !== false,
    retrievalHalfLifeDays: sanitizeNumericSetting(
      settings?.retrievalHalfLifeDays,
      DEFAULT_SETTINGS.retrievalHalfLifeDays
    ),
    staleAfterDays: sanitizeNumericSetting(
      settings?.staleAfterDays,
      DEFAULT_SETTINGS.staleAfterDays
    ),
    transactionWindowDays: sanitizeNumericSetting(
      settings?.transactionWindowDays,
      DEFAULT_SETTINGS.transactionWindowDays
    )
  };
}

export function resolveDefaultModelSettings(settings = {}) {
  const normalized = normalizeSettings(settings);
  return {
    provider: normalized.defaultModelProvider,
    model: normalized.defaultModel,
    enabled: normalized.modelIntelligenceEnabled !== false
  };
}

export function resolveModelForModule(settings = {}, moduleId = "") {
  const normalized = normalizeSettings(settings);
  const usage = MODEL_USAGE_DEFINITIONS.find((item) => item.id === moduleId);
  const requiresIntelligence =
    moduleId && normalized.moduleIntelligence[moduleId] !== undefined
      ? normalized.moduleIntelligence[moduleId]
      : usage?.requiresIntelligence !== false;

  if (!requiresIntelligence) {
    return {
      provider: "",
      model: "",
      enabled: false,
      moduleId
    };
  }

  const assignment = normalized.moduleModelAssignments[moduleId];
  if (!assignment?.provider || !assignment?.model) {
    return {
      provider: "",
      model: "",
      enabled: false,
      moduleId
    };
  }

  return {
    provider: assignment.provider,
    model: assignment.model,
    enabled: normalized.modelIntelligenceEnabled !== false,
    moduleId,
    profile: normalized.moduleAgentProfiles?.[moduleId]?.agents?.[assignment.model] || null,
    agentProfiles: normalized.moduleAgentProfiles?.[moduleId]?.agents || {}
  };
}

function redactSettingsSecrets(settings) {
  const normalized = normalizeSettings(settings);
  return {
    ...normalized,
    googleApiKey: "",
    googleApiKeyConfigured: Boolean(normalized.googleApiKey),
    openRouterApiKey: "",
    openRouterApiKeyConfigured: Boolean(normalized.openRouterApiKey),
    deepSeekApiKey: "",
    deepSeekApiKeyConfigured: Boolean(normalized.deepSeekApiKey),
    modelLibraryAgents: normalized.modelLibraryAgents.map((item) => ({
      ...item,
      apiKey: "",
      apiKeyConfigured: Boolean(item.apiKey) || item.apiKeyConfigured === true,
      token: "",
      tokenConfigured: Boolean(item.token) || item.tokenConfigured === true
    })),
    copilotApiKey: "",
    copilotApiKeyConfigured: Boolean(normalized.copilotApiKey),
    customModelApiKey: "",
    customModelApiKeyConfigured: Boolean(normalized.customModelApiKey),
    customHttpAdapter: {
      ...normalized.customHttpAdapter,
      token: "",
      tokenConfigured: Boolean(normalized.customHttpAdapter?.token)
    },
    customHttpAdapters: normalized.customHttpAdapters.map((adapter) => ({
      ...adapter,
      token: "",
      tokenConfigured: Boolean(adapter.token)
    }))
  };
}

function preserveAdapterListSecrets(incomingAdapters, currentSettings) {
  if (!Array.isArray(incomingAdapters)) {
    return incomingAdapters;
  }
  const currentAdapters = normalizeSettings(currentSettings).customHttpAdapters || [];
  const tokenByAlias = new Map(
    currentAdapters
      .filter((adapter) => adapter.alias && adapter.token)
      .map((adapter) => [adapter.alias, adapter.token])
  );
  return incomingAdapters.map((adapter) => {
    const alias = String(adapter?.alias || adapter?.modelAlias || "").trim();
    if (!alias || String(adapter?.token || adapter?.apiKey || "").trim()) {
      return adapter;
    }
    const token = tokenByAlias.get(alias);
    return token ? { ...adapter, token } : adapter;
  });
}

function preserveModelLibraryAgentSecrets(incomingModels, currentSettings) {
  if (!Array.isArray(incomingModels)) {
    return incomingModels;
  }
  const currentModels = normalizeSettings(currentSettings).modelLibraryAgents || [];
  const currentByKey = new Map();
  for (const model of currentModels) {
    for (const key of [model.uid, model.instanceId, model.alias].filter(Boolean)) {
      currentByKey.set(key, model);
    }
  }
  return incomingModels.map((model) => {
    const key = String(model?.uid || model?.instanceId || model?.alias || "").trim();
    const current = currentByKey.get(key);
    if (!current) {
      return model;
    }
    const next = { ...model };
    if (!String(next.apiKey || "").trim() && current.apiKey) {
      next.apiKey = current.apiKey;
    }
    if (!String(next.token || "").trim() && current.token) {
      next.token = current.token;
    }
    return next;
  });
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    return null;
  }
}

async function listJsonFiles(directory) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    return [];
  }
}

function explicitModelLibraryProviders(settings = {}) {
  if (!Object.hasOwn(settings || {}, "modelLibraryEntries")) {
    return null;
  }
  return normalizeModelLibraryEntries(settings.modelLibraryEntries, settings);
}

function unwrapModelAgentSettings(value, fallbackId = "") {
  const incoming = normalizePlainObject(value);
  const agent = normalizePlainObject(incoming.agent, incoming);
  if (!Object.keys(agent).length) {
    return null;
  }
  const fallback = String(fallbackId || "").replace(/\.json$/i, "");
  return {
    ...agent,
    uid: String(agent.uid || fallback || "").trim(),
    instanceId: String(agent.instanceId || agent.uid || fallback || "").trim(),
    alias: String(agent.alias || agent.uid || fallback || "").trim()
  };
}

async function loadSplitModelAgentSettings(userDataPath, rootSettings = {}) {
  const directory = getModelAgentSettingsDirectory(userDataPath);
  const fileNames = await listJsonFiles(directory);
  if (fileNames.length === 0) {
    return {};
  }

  const byId = new Map();
  const byFileName = new Map();
  for (const fileName of fileNames) {
    const filePath = path.join(directory, fileName);
    const parsed = await readJsonIfExists(filePath);
    const agent = unwrapModelAgentSettings(parsed, fileName);
    if (!agent) {
      continue;
    }
    const ids = [agent.uid, agent.instanceId, agent.alias, fileName.replace(/\.json$/i, "")]
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    for (const id of ids) {
      byId.set(id, agent);
    }
    byFileName.set(fileName, agent);
  }

  const ordered = [];
  const seen = new Set();
  for (const id of normalizeStringList(rootSettings.modelLibraryAgentIds)) {
    const agent = byId.get(id);
    const uid = String(agent?.uid || agent?.instanceId || agent?.alias || "").trim();
    if (agent && uid && !seen.has(uid)) {
      ordered.push(agent);
      seen.add(uid);
    }
  }
  for (const fileName of fileNames) {
    const agent = byFileName.get(fileName);
    const uid = String(agent?.uid || agent?.instanceId || agent?.alias || "").trim();
    if (agent && uid && !seen.has(uid)) {
      ordered.push(agent);
      seen.add(uid);
    }
  }

  return ordered.length > 0
    ? {
        modelLibraryAgentIds: ordered.map((agent) =>
          String(agent.uid || agent.instanceId || agent.alias || "").trim()
        ),
        modelLibraryAgents: ordered
      }
    : {};
}

async function loadSplitModelSettings(userDataPath, rootSettings = {}) {
  const explicitProviders = explicitModelLibraryProviders(rootSettings);
  const providers = explicitProviders || [...MODEL_LIBRARY_PROVIDERS];
  const splitSettings = {};
  for (const provider of providers) {
    const providerSettings = await readJsonIfExists(
      getModelProviderSettingsPath(userDataPath, provider)
    );
    if (providerSettings) {
      Object.assign(splitSettings, providerSettings);
    }
  }
  return splitSettings;
}

async function loadAgentToolExecutionSettings(userDataPath, rootSettings = {}) {
  const splitSettings = await readJsonIfExists(getAgentToolExecutionSettingsPath(userDataPath));
  if (splitSettings) {
    return {
      agentToolExecution: splitSettings.agentToolExecution || splitSettings
    };
  }
  if (rootSettings?.agentToolExecution) {
    return {
      agentToolExecution: rootSettings.agentToolExecution
    };
  }
  return {};
}

function pickProviderSettings(settings = {}, provider = "") {
  const picked = {};
  for (const key of MODEL_PROVIDER_SETTING_KEYS[provider] || []) {
    if (settings[key] !== undefined) {
      picked[key] = settings[key];
    }
  }
  return picked;
}

function stripProviderSettings(settings = {}) {
  const providerKeys = new Set(
    Object.values(MODEL_PROVIDER_SETTING_KEYS).flat()
  );
  return Object.fromEntries(
    Object.entries(settings).filter(
      ([key]) =>
        !providerKeys.has(key) &&
        key !== "agentToolExecution" &&
        key !== "modelLibraryAgents"
    )
  );
}

function removeProviderSettings(settings = {}, providers = []) {
  const removedKeys = new Set(
    providers.flatMap((provider) => MODEL_PROVIDER_SETTING_KEYS[provider] || [])
  );
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => !removedKeys.has(key))
  );
}

function rawModelForProvider(settings = {}, provider = "") {
  switch (provider) {
    case "google-gemini":
      return settings.googleModel || DEFAULT_SETTINGS.googleModel;
    case "openai-chatgpt":
      return settings.openAiModel || DEFAULT_SETTINGS.openAiModel;
    case "deepseek":
      return settings.deepSeekModel || DEFAULT_SETTINGS.deepSeekModel;
    case "openrouter":
      return settings.openRouterModel || DEFAULT_SETTINGS.openRouterModel;
    case "copilot":
      return settings.copilotModel || DEFAULT_SETTINGS.copilotModel;
    case "local-model":
      return settings.localModelName || DEFAULT_SETTINGS.localModelName;
    case "custom-http":
      return settings.customModelAlias || settings.customHttpAdapter?.alias || DEFAULT_SETTINGS.customModelAlias;
    default:
      return DEFAULT_SETTINGS.defaultModel;
  }
}

function modelAgentId(model = {}) {
  return String(model.uid || model.instanceId || model.alias || "").trim();
}

function serializeModelAgentSettings(model = {}) {
  const uid = modelAgentId(model);
  return {
    schemaVersion: 1,
    ...model,
    uid,
    instanceId: String(model.instanceId || uid).trim(),
    alias: String(model.alias || uid).trim()
  };
}

async function writeSplitModelAgentSettings(userDataPath, settings = {}, options = {}) {
  const directory = getModelAgentSettingsDirectory(userDataPath);
  await fs.mkdir(directory, { recursive: true });
  const models = normalizeModelLibraryAgents(settings.modelLibraryAgents, settings);
  const activeFileIds = new Set();

  for (const model of models) {
    const uid = modelAgentId(model);
    const fileId = safeModelAgentFileId(uid);
    if (!fileId) {
      continue;
    }
    activeFileIds.add(fileId);
    await atomicWriteJsonThroughState(
      getModelAgentSettingsPath(userDataPath, fileId),
      serializeModelAgentSettings(model),
      {
        kind: "settings.model_agent.write",
        metadata: {
          uid,
          provider: model.provider,
          model: model.model
        }
      }
    );
  }

  if (options.deleteInactive) {
    for (const fileName of await listJsonFiles(directory)) {
      const fileId = safeModelAgentFileId(fileName.replace(/\.json$/i, ""));
      if (fileId && !activeFileIds.has(fileId)) {
        await fs.rm(path.join(directory, fileName), { force: true });
      }
    }
  }
}

async function writeSplitModelSettings(userDataPath, settings = {}, options = {}) {
  const activeProviders = new Set(
    normalizeModelLibraryEntries(settings.modelLibraryEntries, {
      modelLibraryEntries: settings.modelLibraryEntries
    })
  );
  const directory = getModelSettingsDirectory(userDataPath);
  await fs.mkdir(directory, { recursive: true });

  for (const provider of MODEL_LIBRARY_PROVIDERS) {
    const filePath = getModelProviderSettingsPath(userDataPath, provider);
    if (!activeProviders.has(provider)) {
      if (options.deleteInactive) {
        await fs.rm(filePath, { force: true });
      }
      continue;
    }
    await atomicWriteJsonThroughState(filePath, pickProviderSettings(settings, provider), {
      kind: "settings.model_provider.write",
      metadata: { provider }
    });
  }
}

async function writeAgentToolExecutionSettings(userDataPath, settings = {}) {
  const filePath = getAgentToolExecutionSettingsPath(userDataPath);
  await atomicWriteJsonThroughState(filePath, normalizeAgentToolExecution(settings.agentToolExecution), {
    kind: "settings.agent_tool_execution.write"
  });
}

function settingsStateKey(userDataPath) {
  return `settings:${path.resolve(userDataPath)}`;
}

async function loadSettingsUnlocked(userDataPath, options = {}) {
  const settingsPath = getSettingsPath(userDataPath);
  let parsed = {};

  try {
    const content = await fs.readFile(settingsPath, "utf8");
    parsed = JSON.parse(content);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const splitModelSettings = await loadSplitModelSettings(userDataPath, parsed);
  const splitModelAgentSettings = await loadSplitModelAgentSettings(userDataPath, parsed);
  const agentToolExecutionSettings = await loadAgentToolExecutionSettings(userDataPath, parsed);
  const normalized = normalizeSettings({
    ...parsed,
    ...splitModelSettings,
    ...splitModelAgentSettings,
    ...agentToolExecutionSettings
  });
  return options.redactSecrets ? redactSettingsSecrets(normalized) : normalized;
}

export async function loadSettings(userDataPath, options = {}) {
  await waitForStateIdle(settingsStateKey(userDataPath));
  return loadSettingsUnlocked(userDataPath, options);
}

async function saveSettingsUnlocked(userDataPath, incomingSettings, options = {}) {
  const settingsPath = getSettingsPath(userDataPath);
  const current = await loadSettingsUnlocked(userDataPath);
  const modelLibraryIsAuthoritative = Object.hasOwn(
    incomingSettings || {},
    "modelLibraryEntries"
  );
  const activeIncomingProviders = new Set(
    modelLibraryIsAuthoritative
      ? normalizeModelLibraryEntries(incomingSettings.modelLibraryEntries, {
          modelLibraryEntries: incomingSettings.modelLibraryEntries
        })
      : []
  );
  const shouldPreserveProvider = (provider) =>
    !modelLibraryIsAuthoritative || activeIncomingProviders.has(provider);
  const nextSettings = {
    ...current,
    ...(incomingSettings || {})
  };

  if (
    shouldPreserveProvider("google-gemini") &&
    !String(incomingSettings?.googleApiKey || "").trim() &&
    current.googleApiKey
  ) {
    nextSettings.googleApiKey = current.googleApiKey;
  }
  if (
    shouldPreserveProvider("openrouter") &&
    !String(incomingSettings?.openRouterApiKey || "").trim() &&
    current.openRouterApiKey
  ) {
    nextSettings.openRouterApiKey = current.openRouterApiKey;
  }
  if (
    shouldPreserveProvider("deepseek") &&
    !String(incomingSettings?.deepSeekApiKey || "").trim() &&
    current.deepSeekApiKey
  ) {
    nextSettings.deepSeekApiKey = current.deepSeekApiKey;
  }
  if (
    shouldPreserveProvider("copilot") &&
    !String(incomingSettings?.copilotApiKey || "").trim() &&
    current.copilotApiKey
  ) {
    nextSettings.copilotApiKey = current.copilotApiKey;
  }
  if (
    shouldPreserveProvider("custom-http") &&
    !String(incomingSettings?.customModelApiKey || "").trim() &&
    current.customModelApiKey
  ) {
    nextSettings.customModelApiKey = current.customModelApiKey;
  }
  if (
    shouldPreserveProvider("custom-http") &&
    Array.isArray(incomingSettings?.customHttpAdapters)
  ) {
    nextSettings.customHttpAdapters = preserveAdapterListSecrets(
      incomingSettings.customHttpAdapters,
      current
    );
  }
  if (
    shouldPreserveProvider("custom-http") &&
    !String(incomingSettings?.customHttpAdapter?.token || "").trim() &&
    current.customHttpAdapter?.token
  ) {
    nextSettings.customHttpAdapter = {
      ...(nextSettings.customHttpAdapter || {}),
      token: current.customHttpAdapter.token
    };
  }
  if (Array.isArray(incomingSettings?.modelLibraryAgents)) {
    nextSettings.modelLibraryAgents = preserveModelLibraryAgentSecrets(
      incomingSettings.modelLibraryAgents,
      current
    );
  }

  if (nextSettings.customHttpAdapter) {
    const mergedAdapter = {
      ...(nextSettings.customHttpAdapter || {}),
      ...(incomingSettings.customHttpAdapter || {})
    };
    nextSettings.customHttpAdapter = mergedAdapter;
  }

  if (!modelLibraryIsAuthoritative) {
    const inferredIncomingProviders = normalizeModelLibraryEntries(undefined, incomingSettings);
    if (inferredIncomingProviders.length > 0) {
      nextSettings.modelLibraryEntries = [
        ...new Set([...(current.modelLibraryEntries || []), ...inferredIncomingProviders])
      ];
    }
  }

  if (
    modelLibraryIsAuthoritative &&
    !activeIncomingProviders.has(String(nextSettings.defaultModelProvider || ""))
  ) {
    nextSettings.defaultModelProvider = "";
    nextSettings.defaultModel = "";
  }

  const inactiveProviders = modelLibraryIsAuthoritative
    ? [...MODEL_LIBRARY_PROVIDERS].filter((provider) => !activeIncomingProviders.has(provider))
    : [];
  const merged = normalizeSettings(
    removeProviderSettings(nextSettings, inactiveProviders)
  );

  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await writeSplitModelSettings(userDataPath, merged, {
    deleteInactive: modelLibraryIsAuthoritative
  });
  await writeSplitModelAgentSettings(userDataPath, merged, {
    deleteInactive: modelLibraryIsAuthoritative
  });
  await writeAgentToolExecutionSettings(userDataPath, merged);
  await atomicWriteJsonThroughState(settingsPath, stripProviderSettings({
    ...merged,
    modelLibraryAgentIds: merged.modelLibraryAgents.map((model) => modelAgentId(model)).filter(Boolean)
  }), {
    kind: "settings.main.write"
  });
  return options.redactSecrets ? redactSettingsSecrets(merged) : merged;
}

export async function saveSettings(userDataPath, incomingSettings, options = {}) {
  const settingsPath = getSettingsPath(userDataPath);
  return mutateState({
    key: settingsStateKey(userDataPath),
    kind: "settings.save",
    metadata: { settingsPath },
    task: () => saveSettingsUnlocked(userDataPath, incomingSettings, options)
  });
}
