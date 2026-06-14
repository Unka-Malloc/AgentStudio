import { computed, onBeforeUnmount, onMounted, proxyRefs, ref } from "vue";
import {
  externalServiceBindingModeOptions,
  externalServiceBindingOutletOptions,
  externalServiceCloudDriveModeOptions,
  externalServiceCloudDriveProviderOptions,
  externalServiceHealthCheckTypeOptions,
  externalServiceModelProtocolOptions,
  externalServiceMcpTransportOptions,
  externalServiceModeOptions,
  externalServiceRiskOptions,
  externalServiceStartupPolicyOptions,
  externalServiceUpstreamTypeOptions,
  adoptExternalServiceTools,
  getExternalServiceConfig,
  refreshExternalServiceRuntime,
  saveExternalServiceConfig,
  verifyExternalServiceConfig,
  type ExternalServiceConfig,
  type ExternalServiceEntry,
  type ExternalServiceRuntimeRefreshResult,
  type ExternalServiceState,
  type ExternalServiceTemplate,
  type ExternalServiceTemplateField,
  type ExternalServiceTemplateFieldGroup,
  type ExternalServiceToolReview,
  type ExternalServiceValidation,
} from "../lib/external-services-client";
import type { ServerConsoleShellContext } from "./serverConsoleShellContext";
import { usePageRefreshHandler } from "./usePageRefresh";

type ConfigEditorMode = "add" | "edit";
type ServiceHeartbeatStatus = "idle" | "running" | "refreshed" | "checked" | "failed";
type ServiceHeartbeatState = {
  count: number;
  lastAt: string;
  message: string;
  refreshing: boolean;
  status: ServiceHeartbeatStatus;
};

const EXTERNAL_SERVICE_CONFIG_KIND = "pact.external-service.config";
const SERVICE_HUB_OUTLET = "pact.serviceHub";
const SERVICEHUB_PRODUCTION_POLICY_PRESET = "servicehub.production-default";
const SERVICEHUB_TEMPLATE_IDS = {
  rawMcpStreamableHttp: "external-service.template.raw-mcp-streamable-http",
  rawMcpSse: "external-service.template.raw-mcp-sse",
  httpJson: "external-service.template.http-json",
  httpsJson: "external-service.template.https-json",
  jsonRpc: "external-service.template.json-rpc",
  sse: "external-service.template.sse",
  openaiModelGateway: "external-service.template.openai-model-gateway",
} as const;
const HTTP_METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
const SERVICE_HEARTBEAT_INTERVAL_MS = 60000;
const SERVICE_HEARTBEAT_INITIAL_DELAY_MS = 1200;
const SERVICE_HEARTBEAT_STAGGER_MS = 900;
const SERVICE_TYPE_ALIASES: Record<string, string> = {
  "model-context-protocol": "mcp",
  "mcp-server": "mcp",
  "agent-client-protocol": "acp",
  "agent-communication-protocol": "acp",
  "agent-collaboration-protocol": "acp",
  "acp-server": "acp",
  model: "llm",
  "model-service": "llm",
  llm: "llm",
  "llm-service": "llm",
  drive: "cloud-drive",
  "drive-service": "cloud-drive",
  "cloud-drive": "cloud-drive",
  "cloud-drive-service": "cloud-drive",
  "icloud-drive": "cloud-drive",
  onedrive: "cloud-drive",
  "one-drive": "cloud-drive",
  "google-drive": "cloud-drive",
  dropbox: "cloud-drive",
  openai: "llm",
  "http-service": "http",
  "https-service": "https",
  "rpc-service": "rpc",
  "json-rpc": "json-rpc",
  "json-rpc-service": "json-rpc",
  "sse-service": "sse",
  "openai-api": "llm",
  "openai-compatible": "llm",
  "openai-compatible-api": "llm",
  "anthropic-messages": "llm",
  "gemini-generate-content": "llm",
  "bedrock-converse": "llm",
  "cohere-chat": "llm",
  "ollama-native": "llm",
  "dashscope-native": "llm",
  "huggingface-tgi": "llm",
  "azure-ai-inference": "llm",
  "vertex-ai-prediction": "llm",
  "custom-json-http": "llm",
  custom: "other",
};
const SERVICE_TYPE_TAGS: Record<string, { label: string; tone: string }> = {
  mcp: { label: "MCP 服务", tone: "success" },
  acp: { label: "ACP 服务", tone: "info" },
  llm: { label: "LLM Service", tone: "warning" },
  "cloud-drive": { label: "Cloud Drive Service", tone: "success" },
  http: { label: "HTTP 服务", tone: "info" },
  https: { label: "HTTPS 服务", tone: "info" },
  "json-rpc": { label: "JSON-RPC 服务", tone: "info" },
  sse: { label: "SSE 服务", tone: "info" },
  rpc: { label: "RPC 服务", tone: "info" },
  other: { label: "其它服务", tone: "neutral" },
};
const UPSTREAM_TYPE_OPTION_VALUES = new Set<string>(externalServiceUpstreamTypeOptions.map((option) => option.value));
const MODEL_PROTOCOL_OPTION_VALUES = new Set<string>(externalServiceModelProtocolOptions.map((option) => option.value));

function formatDateTime(value = "") {
  if (!value) return "未生成";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCompactDateTime(value = "") {
  if (!value) return "未生成";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function cloneConfig(config: ExternalServiceConfig): ExternalServiceConfig {
  return JSON.parse(JSON.stringify(config || {})) as ExternalServiceConfig;
}

function uniqueNonEmptyStrings(values: unknown[] = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function isEmptyObject(value: unknown) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function compactEmptyValues<T>(value: T): T | undefined {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => compactEmptyValues(item))
      .filter((item) => item !== undefined);
    return (items.length ? items : undefined) as T | undefined;
  }
  if (!isPlainObject(value)) {
    if (value === "" || value === null || value === undefined) return undefined;
    return value;
  }
  const entries = Object.entries(value)
    .map(([key, entryValue]) => [key, compactEmptyValues(entryValue)] as const)
    .filter(([, entryValue]) => entryValue !== undefined);
  return (entries.length ? Object.fromEntries(entries) : undefined) as T | undefined;
}

function serviceTypeFromConfig(config: ExternalServiceConfig) {
  return normalizeServiceType(config.upstream?.type || "");
}

function isHttpJsonType(type = "") {
  return type === "http" || type === "https";
}

function isJsonRpcType(type = "") {
  return type === "json-rpc" || type === "rpc";
}

function isSseType(type = "") {
  return type === "sse";
}

function isToolMappedType(type = "") {
  return isHttpJsonType(type) || isJsonRpcType(type) || isSseType(type);
}

function defaultToolForUpstreamType(type = "") {
  if (isHttpJsonType(type)) {
    return {
      name: "",
      method: "GET",
      path: "",
    };
  }
  if (isJsonRpcType(type)) {
    return {
      name: "",
      method: "",
    };
  }
  if (isSseType(type)) {
    return {
      name: "",
    };
  }
  return null;
}

function ensurePrimaryToolForType(config: ExternalServiceConfig, type = "") {
  const draft = { ...config };
  if (!isToolMappedType(type)) {
    delete draft.tools;
    return draft;
  }
  const currentTool = (Array.isArray(draft.tools) && isPlainObject(draft.tools[0]))
    ? draft.tools[0]
    : {};
  draft.tools = [
    {
      ...defaultToolForUpstreamType(type),
      ...currentTool,
    },
    ...(Array.isArray(draft.tools) ? draft.tools.slice(1) : []),
  ];
  return draft;
}

function templateIdForUpstream(upstream: ExternalServiceConfig["upstream"]) {
  const type = normalizeServiceType(upstream?.type || "");
  if (type === "mcp") {
    return upstream?.transport === "sse"
      ? SERVICEHUB_TEMPLATE_IDS.rawMcpSse
      : SERVICEHUB_TEMPLATE_IDS.rawMcpStreamableHttp;
  }
  if (type === "http") return SERVICEHUB_TEMPLATE_IDS.httpJson;
  if (type === "https") return SERVICEHUB_TEMPLATE_IDS.httpsJson;
  if (type === "json-rpc" || type === "rpc") return SERVICEHUB_TEMPLATE_IDS.jsonRpc;
  if (type === "sse") return SERVICEHUB_TEMPLATE_IDS.sse;
  if (type === "llm") return SERVICEHUB_TEMPLATE_IDS.openaiModelGateway;
  return "";
}

function bindingModeForUpstream(upstream: ExternalServiceConfig["upstream"]) {
  return normalizeServiceType(upstream?.type || "") === "mcp" ? "passthrough" : "compile";
}

function upstreamDefaultsForTemplateId(templateId = ""): NonNullable<ExternalServiceConfig["upstream"]> {
  if (templateId === SERVICEHUB_TEMPLATE_IDS.rawMcpSse) {
    return { type: "mcp", transport: "sse" };
  }
  if (templateId === SERVICEHUB_TEMPLATE_IDS.rawMcpStreamableHttp) {
    return { type: "mcp", transport: "streamable-http" };
  }
  if (templateId === SERVICEHUB_TEMPLATE_IDS.httpJson) {
    return { type: "http", transport: "http" };
  }
  if (templateId === SERVICEHUB_TEMPLATE_IDS.httpsJson) {
    return { type: "https", transport: "http" };
  }
  if (templateId === SERVICEHUB_TEMPLATE_IDS.jsonRpc) {
    return { type: "json-rpc", transport: "http" };
  }
  if (templateId === SERVICEHUB_TEMPLATE_IDS.sse) {
    return { type: "sse", transport: "sse", eventFormat: "json-data" };
  }
  if (templateId === SERVICEHUB_TEMPLATE_IDS.openaiModelGateway) {
    return { type: "llm", transport: "http" };
  }
  return {};
}

function isServiceHubTemplateId(value = "") {
  return Object.values(SERVICEHUB_TEMPLATE_IDS).includes(value as typeof SERVICEHUB_TEMPLATE_IDS[keyof typeof SERVICEHUB_TEMPLATE_IDS]);
}

function configForSerialization(config: ExternalServiceConfig): ExternalServiceConfig {
  const normalized = cloneConfig(config || createEmptyExternalServiceConfig());
  const inferredTemplateId = templateIdForUpstream(normalized.upstream);
  const upstreamType = serviceTypeFromConfig(normalized);
  normalized.templateId = normalized.templateId || inferredTemplateId;
  normalized.policyPreset = normalized.policyPreset || SERVICEHUB_PRODUCTION_POLICY_PRESET;
  if (normalized.schemaVersion === "v0.0.1:schema:definition-1") delete normalized.schemaVersion;
  if (normalized.kind === EXTERNAL_SERVICE_CONFIG_KIND) delete normalized.kind;
  if (!isServiceHubTemplateId(normalized.templateId || "") && normalized.templateId === inferredTemplateId) {
    delete normalized.templateId;
  }
  if (!normalized.templateId) delete normalized.templateId;
  if (normalized.policyPreset === SERVICEHUB_PRODUCTION_POLICY_PRESET) delete normalized.policyPreset;
  if (normalized.serviceName === normalized.serviceId) delete normalized.serviceName;
  delete normalized.displayName;
  if (normalized.mode === "connected") delete normalized.mode;
  if (normalized.startupPolicy === "external-only") delete normalized.startupPolicy;
  if (normalized.binding?.mode === bindingModeForUpstream(normalized.upstream) &&
    normalized.binding?.outlet === SERVICE_HUB_OUTLET &&
    (normalized.binding.requiredScopes || []).length === 0 &&
    normalized.binding.risk === "read_only" &&
    isEmptyObject(normalized.binding.metadata || {})) {
    delete normalized.binding;
  }
  if (normalized.healthCheck?.type === "none") delete normalized.healthCheck;
  if (isEmptyObject(normalized.metadata || {})) delete normalized.metadata;
  if (isEmptyObject(normalized.scripts || {})) delete normalized.scripts;
  if (normalized.upstream) {
    const upstream = { ...normalized.upstream };
    if (isServiceHubTemplateId(normalized.templateId || "")) {
      delete upstream.type;
    }
    if (isHttpJsonType(upstreamType)) {
      const endpoint = String(upstream.baseUrl || upstream.url || "").trim();
      upstream.baseUrl = endpoint;
      delete upstream.url;
      if (upstream.transport === "http") delete upstream.transport;
    } else if (isJsonRpcType(upstreamType)) {
      upstream.url = String(upstream.url || upstream.baseUrl || "").trim();
      delete upstream.baseUrl;
      if (upstream.transport === "http") delete upstream.transport;
    } else if (isSseType(upstreamType)) {
      delete upstream.baseUrl;
      if (upstream.transport === "sse") delete upstream.transport;
      if (upstream.eventFormat === "json-data") delete upstream.eventFormat;
    } else if (upstreamType === "mcp") {
      delete upstream.baseUrl;
    } else if (upstreamType === "llm") {
      delete upstream.baseUrl;
      if (upstream.transport === "http") delete upstream.transport;
    }
    const compactedUpstream = compactEmptyValues(upstream);
    if (compactedUpstream) {
      normalized.upstream = compactedUpstream as ExternalServiceConfig["upstream"];
    } else {
      delete normalized.upstream;
    }
  }
  if (Array.isArray(normalized.tools)) {
    const compactedTools = compactEmptyValues(normalized.tools);
    if (compactedTools) {
      normalized.tools = compactedTools as unknown[];
    } else {
      delete normalized.tools;
    }
  }
  return normalized;
}

function serializeConfig(config: ExternalServiceConfig) {
  return `${JSON.stringify(configForSerialization(config), null, 2)}\n`;
}

function validationFromState(state: ExternalServiceState | null): ExternalServiceValidation {
  return state?.activeValidation || { ok: false, errors: [], warnings: [] };
}

function uniqueListFromText(value = "") {
  return [...new Set(String(value).split(/[,\n]/).map((item) => item.trim()).filter(Boolean))];
}

function scopesTextFromConfig(config: ExternalServiceConfig) {
  return (config.binding?.requiredScopes || []).join(", ");
}

function templateFieldLabel(field: ExternalServiceTemplateField) {
  const valueSuffix = field.value === undefined || field.value === ""
    ? ""
    : `=${String(field.value)}`;
  const alternatives = (field.alternatives || []).filter(Boolean);
  const alternativeSuffix = alternatives.length ? ` | ${alternatives.join(" | ")}` : "";
  return `${field.path}${valueSuffix}${alternativeSuffix}`;
}

function templateGroupSummary(group: ExternalServiceTemplateFieldGroup) {
  const mode = group.mode === "all-or-none"
    ? "整组填写"
    : group.mode === "any"
      ? "按需填写"
      : "";
  return {
    id: group.id,
    label: group.label,
    mode,
    note: group.note || "",
    fields: (group.fields || []).map(templateFieldLabel),
  };
}

const OPTIONAL_FIELD_EDITOR_HANDLED_PREFIXES = [
  "serviceName",
  "displayName",
  "description",
  "mode",
  "startupPolicy",
  "upstream.auth",
  "upstream.timeoutMs",
  "upstream.modelProtocol",
  "upstream.provider",
  "binding",
  "healthCheck",
] as const;

function optionalFieldPathSegments(pathText = "") {
  return String(pathText || "")
    .trim()
    .replace(/\[\]/g, ".0")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function optionalFieldValueAt(config: ExternalServiceConfig, pathText = "") {
  const segments = optionalFieldPathSegments(pathText);
  let cursor: unknown = config;
  for (const segment of segments) {
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      cursor = Number.isInteger(index) ? cursor[index] : undefined;
    } else if (isPlainObject(cursor)) {
      cursor = cursor[segment];
    } else {
      cursor = undefined;
    }
    if (cursor === undefined) break;
  }
  if (cursor === undefined || cursor === null || cursor === "") return "";
  if (typeof cursor === "object") return JSON.stringify(cursor, null, 2);
  return String(cursor);
}

function parseOptionalFieldInput(pathText = "", value = "") {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  if (pathText.endsWith(".eventTypes")) {
    return uniqueNonEmptyStrings(text.split(/[,\n]/));
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function setOptionalFieldValue(config: ExternalServiceConfig, pathText = "", value = "") {
  const segments = optionalFieldPathSegments(pathText);
  if (!segments.length) return config;
  const draft = cloneConfig(config);
  const parsedValue = parseOptionalFieldInput(pathText, value);
  let cursor: any = draft;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];
    if (Array.isArray(cursor)) {
      const arrayIndex = Number(segment);
      if (!Number.isInteger(arrayIndex)) return draft;
      cursor[arrayIndex] = cursor[arrayIndex] || (Number.isInteger(Number(nextSegment)) ? [] : {});
      cursor = cursor[arrayIndex];
      continue;
    }
    if (!isPlainObject(cursor)) return draft;
    cursor[segment] = cursor[segment] || (Number.isInteger(Number(nextSegment)) ? [] : {});
    cursor = cursor[segment];
  }
  const leaf = segments[segments.length - 1];
  if (parsedValue === undefined) {
    if (Array.isArray(cursor)) {
      const arrayIndex = Number(leaf);
      if (Number.isInteger(arrayIndex)) {
        cursor.splice(arrayIndex, 1);
      }
    } else if (isPlainObject(cursor)) {
      delete cursor[leaf];
    }
  } else if (Array.isArray(cursor)) {
    const arrayIndex = Number(leaf);
    if (Number.isInteger(arrayIndex)) {
      cursor[arrayIndex] = parsedValue;
    }
  } else if (isPlainObject(cursor)) {
    cursor[leaf] = parsedValue;
  }
  return compactEmptyValues(draft) || createEmptyExternalServiceConfig();
}

function isOptionalEditorHandledPath(pathText = "") {
  const normalized = String(pathText || "").trim();
  return !normalized ||
    normalized.includes("|") ||
    OPTIONAL_FIELD_EDITOR_HANDLED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}.`));
}

function createEmptyExternalServiceConfig(): ExternalServiceConfig {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    kind: EXTERNAL_SERVICE_CONFIG_KIND,
    templateId: SERVICEHUB_TEMPLATE_IDS.rawMcpStreamableHttp,
    policyPreset: SERVICEHUB_PRODUCTION_POLICY_PRESET,
    serviceId: "",
    serviceName: "",
    mode: "connected",
    startupPolicy: "external-only",
    description: "",
    scripts: {},
    upstream: {
      type: "mcp",
      transport: "streamable-http",
      url: "",
      timeoutMs: null,
      metadata: {},
    },
    binding: {
      mode: "passthrough",
      outlet: SERVICE_HUB_OUTLET,
      requiredScopes: [],
      risk: "read_only",
      metadata: {},
    },
    healthCheck: {
      type: "none",
      url: "",
      host: "127.0.0.1",
      port: null,
      path: "/",
      timeoutMs: 60000,
      required: false,
    },
    metadata: {},
  };
}

function normalizeConfigDraft(
  raw: ExternalServiceConfig,
  options: { preserveMissingUpstream?: boolean } = {},
): ExternalServiceConfig {
  const config = cloneConfig(raw || createEmptyExternalServiceConfig());
  const empty = createEmptyExternalServiceConfig();
  const templateDefaults = upstreamDefaultsForTemplateId(String(config.templateId || ""));
  const hasUpstreamConfig = Boolean(
    config.upstream && typeof config.upstream === "object" && !Array.isArray(config.upstream),
  );
  const upstream = options.preserveMissingUpstream && !hasUpstreamConfig
    ? undefined
    : {
        ...empty.upstream,
        ...templateDefaults,
        ...(config.upstream || {}),
        type: config.upstream?.type || templateDefaults.type || empty.upstream?.type,
        provider: config.upstream?.provider || "",
        providers: config.upstream?.providers || [],
        mode: config.upstream?.mode || "",
        modelProtocol: config.upstream?.modelProtocol || "",
        transport: config.upstream?.transport || templateDefaults.transport || empty.upstream?.transport,
        url: config.upstream?.url || "",
        baseUrl: config.upstream?.baseUrl || "",
        eventFormat: config.upstream?.eventFormat || "",
        endpointUrl: config.upstream?.endpointUrl || "",
        endpointRef: config.upstream?.endpointRef || "",
        rootPath: config.upstream?.rootPath || "",
        secretRef: config.upstream?.secretRef || "",
        timeoutMs: config.upstream?.timeoutMs ?? null,
      };
  return {
    ...config,
    schemaVersion: String(config.schemaVersion || "v0.0.1:schema:definition-1"),
    kind: config.kind || EXTERNAL_SERVICE_CONFIG_KIND,
    templateId: config.templateId || templateIdForUpstream(upstream),
    policyPreset: config.policyPreset || SERVICEHUB_PRODUCTION_POLICY_PRESET,
    serviceId: String(config.serviceId || ""),
    serviceName: String(config.serviceName || ""),
    displayName: String(config.displayName || ""),
    mode: config.mode || empty.mode,
    startupPolicy: config.startupPolicy || empty.startupPolicy,
    description: String(config.description || ""),
    scripts: config.scripts || {},
    upstream,
    binding: {
      ...empty.binding,
      ...(config.binding || {}),
      mode: config.binding?.mode || bindingModeForUpstream(upstream),
      outlet: config.binding?.outlet || SERVICE_HUB_OUTLET,
      requiredScopes: config.binding?.requiredScopes || [],
      risk: config.binding?.risk || empty.binding?.risk,
    },
    healthCheck: {
      ...empty.healthCheck,
      ...(config.healthCheck || {}),
      type: config.healthCheck?.type || empty.healthCheck?.type,
      url: config.healthCheck?.url || "",
      host: config.healthCheck?.host || empty.healthCheck?.host,
      port: config.healthCheck?.port ?? null,
      path: config.healthCheck?.path || empty.healthCheck?.path,
      timeoutMs: Number(config.healthCheck?.timeoutMs || empty.healthCheck?.timeoutMs || 60000),
      required: config.healthCheck?.required === true,
    },
    metadata: config.metadata || {},
  };
}

function configTextFromEntry(entry: ExternalServiceEntry) {
  return serializeConfig(normalizeConfigDraft(entry.config || createEmptyExternalServiceConfig()));
}

function serviceUpstream(entry: ExternalServiceEntry): NonNullable<ExternalServiceConfig["upstream"]> | null {
  return (entry.config?.upstream || entry.externalMcp?.upstream || null) as NonNullable<ExternalServiceConfig["upstream"]> | null;
}

function normalizeServiceType(value = "") {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  return SERVICE_TYPE_ALIASES[normalized] || normalized;
}

function parseEndpoint(value = "") {
  try {
    return new URL(String(value || "").trim());
  } catch {
    return null;
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textField(record: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function endpointHostPort(value = "") {
  const endpoint = parseEndpoint(value);
  if (!endpoint?.hostname) {
    return "";
  }
  return endpoint.port ? `${endpoint.hostname}:${endpoint.port}` : `${endpoint.hostname}:未声明端口`;
}

function firstConfiguredScriptPath(entry: ExternalServiceEntry) {
  const scripts = entry.config?.scripts || {};
  for (const script of Object.values(scripts)) {
    const pathValue = String(script?.path || script?.cwd || script?.command?.executable || "").trim();
    if (pathValue) {
      return pathValue;
    }
  }
  return "";
}

function resolveUpstreamTarget(entry: ExternalServiceEntry) {
  const upstream = serviceUpstream(entry);
  const upstreamMetadata = objectRecord(upstream?.metadata);
  const docker = objectRecord(entry.config?.docker);
  const dockerMetadata = objectRecord(entry.config?.metadata ? objectRecord(entry.config.metadata)?.docker : null);
  const urlTarget = endpointHostPort(upstream?.url || upstream?.endpointUrl || "");
  if (urlTarget) {
    return { detail: "endpoint", label: urlTarget };
  }
  const rootPath = String(
    upstream?.rootPath ||
    textField(upstreamMetadata, ["rootPath", "localPath", "path", "basePath"]) ||
    "",
  ).trim();
  if (rootPath) {
    return { detail: "local path", label: rootPath };
  }
  const dockerContainer = textField(docker, ["containerName", "container", "name", "serviceName", "composeService"]) ||
    textField(dockerMetadata, ["containerName", "container", "name", "serviceName", "composeService"]);
  if (dockerContainer) {
    return { detail: "docker container", label: dockerContainer };
  }
  const scriptPath = firstConfiguredScriptPath(entry);
  if (scriptPath) {
    return { detail: "script path", label: scriptPath };
  }
  const includePath = String(entry.config?.includePaths?.[0] || entry.config?.scriptRoots?.[0] || "").trim();
  if (includePath) {
    return { detail: "local path", label: includePath };
  }
  const healthHost = String(entry.healthCheck?.host || "").trim();
  const healthPort = entry.healthCheck?.port;
  if (healthHost && healthPort) {
    return { detail: "health target", label: `${healthHost}:${healthPort}` };
  }
  const endpointRef = String(upstream?.endpointRef || "").trim();
  if (endpointRef) {
    return { detail: "endpoint ref", label: endpointRef };
  }
  const filePath = String(entry.filePath || "").trim();
  if (filePath) {
    return { detail: "config path", label: filePath };
  }
  return { detail: "missing target", label: "未声明上游目标" };
}

function inferServiceTypeFromIdentity(entry: ExternalServiceEntry) {
  const text = [entry.serviceId, entry.serviceName, entry.displayName].join(" ").toLowerCase();
  if (text.includes("openai")) {
    return "llm";
  }
  if (/\b(icloud|onedrive|one-drive|google-drive|dropbox|cloud-drive|drive)\b/.test(text)) {
    return "cloud-drive";
  }
  if (/\b(llm|model)\b/.test(text)) {
    return "llm";
  }
  if (/\bacp\b/.test(text)) {
    return "acp";
  }
  if (/\bmcp\b/.test(text)) {
    return "mcp";
  }
  return "";
}

function isOpenAiHost(host = "") {
  return host === "openai.com" || host.endsWith(".openai.com");
}

function inferServiceType(entry: ExternalServiceEntry) {
  const upstream = serviceUpstream(entry);
  const explicitType = normalizeServiceType(upstream?.type || "");
  if (explicitType) {
    return explicitType;
  }
  if (upstream?.modelProtocol || upstream?.provider) {
    return "llm";
  }
  const endpoint = parseEndpoint(upstream?.url || "");
  const host = endpoint?.hostname.toLowerCase() || "";
  if (isOpenAiHost(host)) {
    return "llm";
  }
  const identityType = inferServiceTypeFromIdentity(entry);
  if (identityType) {
    return identityType;
  }
  if (endpoint?.protocol === "http:") {
    return "http";
  }
  if (endpoint?.protocol === "https:") {
    return "https";
  }
  return "other";
}

function serviceTypeTag(entry: ExternalServiceEntry) {
  const upstream = serviceUpstream(entry);
  const rawType = String(upstream?.type || "").trim();
  const type = inferServiceType(entry);
  const known = SERVICE_TYPE_TAGS[type];
  if (known) {
    return { ...known, type, rawType };
  }
  return {
    label: `${rawType || type} 服务`,
    tone: "neutral",
    type,
    rawType,
  };
}

function numericOrNull(value: string | number | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function useExternalServicesViewController(shell: ServerConsoleShellContext) {
  const state = ref<ExternalServiceState | null>(null);
  const configDraft = ref<ExternalServiceConfig>(createEmptyExternalServiceConfig());
  const configText = ref(serializeConfig(configDraft.value));
  const configEditorOpen = ref(false);
  const configEditorMode = ref<ConfigEditorMode>("add");
  const editingServiceLabel = ref("");
  const requiredScopesText = ref(scopesTextFromConfig(configDraft.value));
  const loading = ref(false);
  const saving = ref(false);
  const verifying = ref(false);
  const refreshingRuntime = ref(false);
  const dirty = ref(false);
  const loadError = ref("");
  const actionError = ref("");
  const actionMessage = ref("");
  const activeValidation = ref<ExternalServiceValidation>({ ok: false, errors: [], warnings: [] });
  const serviceHeartbeats = ref<Record<string, ServiceHeartbeatState>>({});
  const adoptingServiceIds = ref<Record<string, boolean>>({});
  const serviceHeartbeatTimers = new Map<string, { intervalId?: number; timeoutId?: number }>();

  const activeTab = computed(() => "list");
  const services = computed(() => state.value?.services || []);
  const templates = computed<ExternalServiceTemplate[]>(() =>
    state.value?.templates || state.value?.templateCatalog?.templates || [],
  );
  const configuredCount = computed(() => state.value?.configuredCount || 0);
  const presetCount = computed(() => state.value?.presetCount || 0);
  const validServiceCount = computed(() => services.value.filter((item) => item.validationStatus === "valid").length);
  const discoveredServiceCount = computed(() => services.value.length);
  const mcpToolCount = computed(() =>
    services.value.reduce((total, item) => total + Number(item.externalMcp?.toolCount || 0), 0),
  );
  const discoveryCacheUpdatedAtLabel = computed(() => formatDateTime(state.value?.externalMcpCache?.updatedAt || ""));
  const registryPath = computed(() => state.value?.registryPath || "");
  const validationErrors = computed(() => activeValidation.value.errors || []);
  const validationWarnings = computed(() => activeValidation.value.warnings || []);
  const configStatusTone = computed(() => activeValidation.value.ok ? "success" : "danger");
  const configStatusLabel = computed(() => activeValidation.value.ok ? "Valid" : "Invalid");
  const upstreamTypeSelectValue = computed(() => {
    const type = String(configDraft.value.upstream?.type || "").trim();
    return UPSTREAM_TYPE_OPTION_VALUES.has(type) ? type : "other";
  });
  const showCustomUpstreamType = computed(() => upstreamTypeSelectValue.value === "other");
  const isLlmServiceDraft = computed(() =>
    normalizeServiceType(configDraft.value.upstream?.type || "") === "llm" ||
    (
      normalizeServiceType(configDraft.value.upstream?.type || "") !== "cloud-drive" &&
      Boolean(configDraft.value.upstream?.modelProtocol || configDraft.value.upstream?.provider)
    ),
  );
  const isCloudDriveServiceDraft = computed(() =>
    normalizeServiceType(configDraft.value.upstream?.type || "") === "cloud-drive",
  );
  const isMcpServiceDraft = computed(() =>
    normalizeServiceType(configDraft.value.upstream?.type || "") === "mcp",
  );
  const isHttpJsonServiceDraft = computed(() =>
    isHttpJsonType(normalizeServiceType(configDraft.value.upstream?.type || "")),
  );
  const isJsonRpcServiceDraft = computed(() =>
    isJsonRpcType(normalizeServiceType(configDraft.value.upstream?.type || "")),
  );
  const isSseServiceDraft = computed(() =>
    isSseType(normalizeServiceType(configDraft.value.upstream?.type || "")),
  );
  const showToolMappingFields = computed(() =>
    isToolMappedType(normalizeServiceType(configDraft.value.upstream?.type || "")),
  );
  const showMcpTransportField = computed(() => isMcpServiceDraft.value);
  const endpointFieldLabel = computed(() => {
    if (isHttpJsonServiceDraft.value) return "Base URL";
    if (isJsonRpcServiceDraft.value) return "JSON-RPC URL";
    if (isSseServiceDraft.value) return "SSE URL";
    return "Endpoint URL";
  });
  const endpointFieldPlaceholder = computed(() => {
    if (isHttpJsonServiceDraft.value) return "https://api.example.com:443";
    if (isJsonRpcServiceDraft.value) return "https://rpc.example.com:443/jsonrpc";
    if (isSseServiceDraft.value) return "https://events.example.com:443/v1/events";
    if (isMcpServiceDraft.value) return "https://mcp.example.com:443/mcp/";
    if (isLlmServiceDraft.value) return "https://api.openai.com:443/v1/responses";
    return "https://service.example.com:443/api";
  });
  const endpointFieldValue = computed(() =>
    isHttpJsonServiceDraft.value
      ? (configDraft.value.upstream?.baseUrl || configDraft.value.upstream?.url || "")
      : (configDraft.value.upstream?.url || configDraft.value.upstream?.endpointUrl || ""),
  );
  const primaryTool = computed<Record<string, any>>(() =>
    Array.isArray(configDraft.value.tools) && isPlainObject(configDraft.value.tools[0])
      ? configDraft.value.tools[0] as Record<string, any>
      : {},
  );
  const primaryToolName = computed(() => String(primaryTool.value.name || primaryTool.value.toolId || primaryTool.value.id || ""));
  const primaryHttpMethod = computed(() => String(primaryTool.value.method || primaryTool.value.transport?.method || "GET").toUpperCase());
  const primaryHttpPath = computed(() => String(primaryTool.value.path || primaryTool.value.transport?.path || ""));
  const primaryRpcMethod = computed(() => String(primaryTool.value.rpc?.method || primaryTool.value.method || ""));
  const upstreamAuth = computed<Record<string, unknown>>(() =>
    isPlainObject(configDraft.value.upstream?.auth) ? configDraft.value.upstream?.auth as Record<string, unknown> : {},
  );
  const upstreamAuthType = computed(() => String(upstreamAuth.value.type || ""));
  const upstreamAuthSecretRef = computed(() => String(upstreamAuth.value.secretRef || ""));
  const upstreamAuthHeaderName = computed(() => String(upstreamAuth.value.headerName || ""));
	  const modelProtocolSelectValue = computed(() => {
	    const protocol = String(configDraft.value.upstream?.modelProtocol || "").trim();
	    if (!protocol) return "openai-responses";
	    return MODEL_PROTOCOL_OPTION_VALUES.has(protocol) ? protocol : "openai-responses";
	  });
  const customUpstreamTypeValue = computed(() => {
    const type = String(configDraft.value.upstream?.type || "").trim();
    return UPSTREAM_TYPE_OPTION_VALUES.has(type) ? "" : type;
  });
  const configEditorTitle = computed(() =>
    configEditorMode.value === "add" ? "添加服务" : `修改配置：${editingServiceLabel.value || configDraft.value.serviceId}`,
  );
  const configEditorSubtitle = computed(() =>
    configEditorMode.value === "add"
      ? "默认只填写当前协议的最小可用组合；其余字段放在组合可选项中。"
      : "修改当前外部服务配置；Service ID 已锁定，避免误新增服务。",
  );
  const currentTemplateId = computed(() =>
    templateIdForUpstream(configDraft.value.upstream) || String(configDraft.value.templateId || ""),
  );
  const currentTemplate = computed(() =>
    templates.value.find((template) => template.templateId === currentTemplateId.value) || null,
  );
  const currentTemplateFieldModel = computed(() =>
    currentTemplate.value?.fieldModel || currentTemplate.value?.formContract?.fieldModel || null,
  );
  const currentTemplateLabel = computed(() =>
    currentTemplate.value?.label ||
      SERVICE_TYPE_TAGS[normalizeServiceType(configDraft.value.upstream?.type || "")]?.label ||
      "自定义服务",
  );
  const minimumFieldLabels = computed(() => {
    const minimumFields = currentTemplateFieldModel.value?.minimum?.fields || [];
    if (minimumFields.length) {
      return minimumFields.map(templateFieldLabel);
    }
    return currentTemplate.value?.minimalRequiredFields || [];
  });
  const requiredFieldGroupSummaries = computed(() =>
    (currentTemplateFieldModel.value?.requiredGroups || []).map(templateGroupSummary),
  );
	  const optionalFieldGroupSummaries = computed(() =>
	    (currentTemplateFieldModel.value?.optionalGroups || []).map(templateGroupSummary),
	  );
	  const advancedOptionalFieldRows = computed(() =>
	    (currentTemplateFieldModel.value?.optionalGroups || [])
	      .flatMap((group) =>
	        (group.fields || [])
	          .filter((field) => !isOptionalEditorHandledPath(field.path))
	          .map((field) => ({
	            id: `${group.id}:${field.path}`,
	            groupId: group.id,
	            groupLabel: group.label,
	            mode: group.mode || "",
	            path: field.path,
	            label: field.label || field.path,
	            note: field.note || group.note || "",
	            placeholder: field.placeholder || "",
	            value: optionalFieldValueAt(configDraft.value, field.path),
	          }))
	      ),
	  );
	  const defaultedFieldLabels = computed(() => {
    const templateInjectedDefaults = currentTemplate.value?.formContract?.fieldCategories?.defaultedByTemplateFields || [];
    if (templateInjectedDefaults.length) {
      return templateInjectedDefaults;
    }
    const defaultedFields = (currentTemplateFieldModel.value?.defaultedGroups || [])
      .flatMap((group) => group.fields || []);
    if (defaultedFields.length) {
      return defaultedFields.map(templateFieldLabel);
    }
    return currentTemplate.value?.defaultedFields || [];
  });

  const activeConfigSummary = computed(() => ({
    serviceId: configDraft.value.serviceId || "-",
    serviceName: configDraft.value.serviceName || "-",
    mode: configDraft.value.mode || "-",
    startupPolicy: configDraft.value.startupPolicy || "-",
    upstreamType: configDraft.value.upstream?.type || "-",
    upstreamEndpoint: configDraft.value.upstream?.url || configDraft.value.upstream?.endpointUrl || "-",
    scripts: Object.keys(configDraft.value.scripts || {}).sort(),
    featureIds: configDraft.value.featureIds || [],
    requiredOperations: configDraft.value.requiredOperations || [],
  }));

  function commitConfigDraft(
    config: ExternalServiceConfig,
    options: { markDirty?: boolean; preserveMissingUpstream?: boolean } = {},
  ) {
    const normalized = normalizeConfigDraft(config, {
      preserveMissingUpstream: options.preserveMissingUpstream === true,
    });
    configDraft.value = normalized;
    configText.value = serializeConfig(normalized);
    requiredScopesText.value = scopesTextFromConfig(normalized);
    dirty.value = options.markDirty === true;
  }

  function serviceHeartbeatKey(entry: ExternalServiceEntry | string) {
    if (typeof entry === "string") {
      return entry;
    }
    return entry.serviceId || entry.entryId;
  }

  function serviceCandidateToolNames(entry: ExternalServiceEntry) {
    return Array.isArray(entry.externalMcp?.candidateTools)
      ? entry.externalMcp.candidateTools.map((name) => String(name || "").trim()).filter(Boolean)
      : [];
  }

  function serviceActiveToolNames(entry: ExternalServiceEntry) {
    return Array.isArray(entry.externalMcp?.activeTools)
      ? entry.externalMcp.activeTools.map((name) => String(name || "").trim()).filter(Boolean)
      : [];
  }

  function serviceToolDetailRows(entry: ExternalServiceEntry, kind: "candidate" | "active"): ExternalServiceToolReview[] {
    const detailRows = kind === "candidate"
      ? entry.externalMcp?.candidateToolDetails
      : entry.externalMcp?.activeToolDetails;
    if (Array.isArray(detailRows) && detailRows.length > 0) {
      return detailRows
        .map((tool) => ({
          ...tool,
          name: String(tool?.name || "").trim(),
        }))
        .filter((tool) => Boolean(tool.name));
    }
    const names = kind === "candidate" ? serviceCandidateToolNames(entry) : serviceActiveToolNames(entry);
    return names.map((name) => ({
      name,
      title: name,
      adoptionState: kind,
      reasonCode: kind === "candidate" ? "details_missing" : "",
    }));
  }

  function serviceCandidateToolReviewRows(entry: ExternalServiceEntry) {
    return serviceToolDetailRows(entry, "candidate");
  }

  function serviceActiveToolReviewRows(entry: ExternalServiceEntry) {
    return serviceToolDetailRows(entry, "active");
  }

  function serviceCandidateToolFingerprintMap(entry: ExternalServiceEntry, toolNames: string[] = []) {
    const selected = new Set(uniqueNonEmptyStrings(toolNames));
    return Object.fromEntries(
      serviceCandidateToolReviewRows(entry)
        .filter((tool) => selected.size === 0 || selected.has(tool.name))
        .map((tool) => [
          tool.name,
          String(tool.fingerprint || tool.review?.diff?.currentFingerprint || "").trim(),
        ])
        .filter(([, fingerprint]) => Boolean(fingerprint)),
    );
  }

  function serviceCandidateToolCount(entry: ExternalServiceEntry) {
    return Number(entry.externalMcp?.candidateToolCount ?? serviceCandidateToolNames(entry).length ?? 0);
  }

  function serviceActiveToolCount(entry: ExternalServiceEntry) {
    return Number(entry.externalMcp?.activeToolCount ?? serviceActiveToolNames(entry).length ?? 0);
  }

  function serviceToolAdoptionLabel(entry: ExternalServiceEntry) {
    const activeCount = serviceActiveToolCount(entry);
    const candidateCount = serviceCandidateToolCount(entry);
    if (candidateCount > 0) {
      return `${candidateCount} candidate / ${activeCount} active`;
    }
    if (activeCount > 0) {
      return `${activeCount} active`;
    }
    if (entry.externalMcp?.toolCount) {
      return `${entry.externalMcp.toolCount} discovered`;
    }
    return "no tools";
  }

  function isServiceToolAdopting(entry: ExternalServiceEntry | string) {
    return adoptingServiceIds.value[serviceHeartbeatKey(entry)] === true;
  }

  function emptyServiceHeartbeat(): ServiceHeartbeatState {
    return {
      count: 0,
      lastAt: "",
      message: "尚未刷新",
      refreshing: false,
      status: "idle",
    };
  }

  function updateServiceHeartbeat(serviceId: string, patch: Partial<ServiceHeartbeatState>) {
    const key = serviceHeartbeatKey(serviceId);
    if (!key) return;
    serviceHeartbeats.value = {
      ...serviceHeartbeats.value,
      [key]: {
        ...(serviceHeartbeats.value[key] || emptyServiceHeartbeat()),
        ...patch,
      },
    };
  }

  function clearServiceHeartbeatTimer(serviceId: string) {
    const key = serviceHeartbeatKey(serviceId);
    const timer = serviceHeartbeatTimers.get(key);
    if (timer?.timeoutId) {
      window.clearTimeout(timer.timeoutId);
    }
    if (timer?.intervalId) {
      window.clearInterval(timer.intervalId);
    }
    serviceHeartbeatTimers.delete(key);
  }

  function clearServiceHeartbeatTimers() {
    for (const key of serviceHeartbeatTimers.keys()) {
      clearServiceHeartbeatTimer(key);
    }
  }

  function resultHeartbeatStatus(status = ""): ServiceHeartbeatStatus {
    if (status === "failed") return "failed";
    if (status === "refreshed") return "refreshed";
    return "checked";
  }

  function resultHeartbeatMessage(result: ExternalServiceRuntimeRefreshResult["results"][number] | undefined) {
    if (!result) return "已检查";
    if (result.status === "failed") return result.error || "刷新失败";
    if (result.status === "refreshed") {
      return typeof result.toolCount === "number" ? `${result.toolCount} tools` : "已刷新";
    }
    if (result.reason === "not_mcp_passthrough") return "已检查";
    return result.reason || "已检查";
  }

  function scheduleServiceHeartbeat(entry: ExternalServiceEntry, index = 0) {
    const key = serviceHeartbeatKey(entry);
    if (!key || typeof window === "undefined" || serviceHeartbeatTimers.has(key)) return;
    const run = () => {
      void refreshRuntime(key, { heartbeat: true, silent: true });
    };
    const timeoutId = window.setTimeout(() => {
      run();
      const intervalId = window.setInterval(run, SERVICE_HEARTBEAT_INTERVAL_MS);
      serviceHeartbeatTimers.set(key, { intervalId });
    }, SERVICE_HEARTBEAT_INITIAL_DELAY_MS + index * SERVICE_HEARTBEAT_STAGGER_MS);
    serviceHeartbeatTimers.set(key, { timeoutId });
  }

  function reconcileServiceHeartbeats(nextServices: ExternalServiceEntry[]) {
    const nextIds = new Set(nextServices.map((entry) => serviceHeartbeatKey(entry)).filter(Boolean));
    const nextHeartbeats: Record<string, ServiceHeartbeatState> = {};
    for (const entry of nextServices) {
      const key = serviceHeartbeatKey(entry);
      if (!key) continue;
      nextHeartbeats[key] = serviceHeartbeats.value[key] || emptyServiceHeartbeat();
    }
    serviceHeartbeats.value = nextHeartbeats;
    for (const key of serviceHeartbeatTimers.keys()) {
      if (!nextIds.has(key)) {
        clearServiceHeartbeatTimer(key);
      }
    }
    nextServices.forEach((entry, index) => scheduleServiceHeartbeat(entry, index));
  }

  async function refreshExternalServices() {
    loading.value = true;
    loadError.value = "";
    try {
      const payload = await getExternalServiceConfig();
      state.value = payload;
      activeValidation.value = validationFromState(payload);
      reconcileServiceHeartbeats(payload.services || []);
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : String(error);
    } finally {
      loading.value = false;
    }
  }

  function openAddServiceConfig() {
    configEditorMode.value = "add";
    editingServiceLabel.value = "";
    const defaultTemplate = templates.value.find((template) =>
      template.templateId === SERVICEHUB_TEMPLATE_IDS.rawMcpStreamableHttp
    );
    const minimumDraft = defaultTemplate?.formContract?.minimumUsableCombination?.draft ||
      defaultTemplate?.operatorMinimumDraft ||
      createEmptyExternalServiceConfig();
    commitConfigDraft(minimumDraft);
    activeValidation.value = { ok: false, errors: [], warnings: [] };
    actionError.value = "";
    actionMessage.value = "";
    configEditorOpen.value = true;
    shell.openExternalServiceTab("list");
  }

  function openEditServiceConfig(entry: ExternalServiceEntry) {
    configEditorMode.value = "edit";
    editingServiceLabel.value = entry.displayName || entry.serviceId;
    commitConfigDraft(entry.config || createEmptyExternalServiceConfig(), { preserveMissingUpstream: true });
    activeValidation.value = entry.validation || { ok: false, errors: [], warnings: [] };
    actionError.value = "";
    actionMessage.value = "";
    configEditorOpen.value = true;
    shell.openExternalServiceTab("list");
  }

  function closeConfigEditor() {
    configEditorOpen.value = false;
    actionError.value = "";
    actionMessage.value = "";
  }

  async function verifyConfig() {
    verifying.value = true;
    actionError.value = "";
    actionMessage.value = "";
    try {
      const result = await verifyExternalServiceConfig(configText.value);
      activeValidation.value = result.validation;
      actionMessage.value = result.ok ? "配置校验通过。" : "配置校验未通过。";
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error);
    } finally {
      verifying.value = false;
    }
  }

  async function refreshRuntime(
    serviceId = "",
    options: { heartbeat?: boolean; silent?: boolean } = {},
  ) {
    const scopedServiceId = String(serviceId || "").trim();
    if (scopedServiceId && serviceHeartbeats.value[scopedServiceId]?.refreshing) {
      return;
    }
    if (scopedServiceId) {
      updateServiceHeartbeat(scopedServiceId, {
        refreshing: true,
        status: "running",
        message: "刷新中",
      });
    } else {
      refreshingRuntime.value = true;
    }
    if (!options.silent) {
      actionError.value = "";
      actionMessage.value = "";
    }
    try {
      const result = await refreshExternalServiceRuntime(scopedServiceId);
      if (result.state) {
        state.value = result.state;
        activeValidation.value = validationFromState(result.state);
        reconcileServiceHeartbeats(result.state.services || []);
      } else {
        await refreshExternalServices();
      }
      const refreshedAt = result.refreshedAt || new Date().toISOString();
      const results = result.results || [];
      if (scopedServiceId) {
        const itemResult = results.find((item) => item.serviceId === scopedServiceId) || results[0];
        const previous = serviceHeartbeats.value[scopedServiceId] || emptyServiceHeartbeat();
        updateServiceHeartbeat(scopedServiceId, {
          count: previous.count + 1,
          lastAt: refreshedAt,
          message: resultHeartbeatMessage(itemResult),
          refreshing: false,
          status: resultHeartbeatStatus(itemResult?.status || (result.ok ? "checked" : "failed")),
        });
      } else {
        for (const itemResult of results) {
          const key = itemResult.serviceId;
          const previous = serviceHeartbeats.value[key] || emptyServiceHeartbeat();
          updateServiceHeartbeat(key, {
            count: previous.count + 1,
            lastAt: refreshedAt,
            message: resultHeartbeatMessage(itemResult),
            refreshing: false,
            status: resultHeartbeatStatus(itemResult.status),
          });
        }
      }
      const catalogCount = result.toolCatalogRefresh?.externalMcpOperationCount;
      const suffix = typeof catalogCount === "number" ? `，目录中 ${catalogCount} 个外部 MCP 工具。` : "。";
      if (!options.silent) {
        const scopedResult = scopedServiceId
          ? (results.find((item) => item.serviceId === scopedServiceId) || results[0])
          : undefined;
        actionMessage.value = scopedServiceId
          ? `${scopedResult?.displayName || scopedServiceId} 服务探测完成：${resultHeartbeatMessage(scopedResult)}。`
          : result.ok
            ? `后台刷新完成：${result.refreshedCount} 个服务已刷新，${result.skippedCount} 个跳过${suffix}`
            : `后台刷新完成：${result.refreshedCount} 个成功，${result.failedCount} 个失败。`;
        if (!result.ok) {
          actionError.value = results.find((item) => item.status === "failed")?.error || "";
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (scopedServiceId) {
        const previous = serviceHeartbeats.value[scopedServiceId] || emptyServiceHeartbeat();
        updateServiceHeartbeat(scopedServiceId, {
          count: previous.count + 1,
          lastAt: new Date().toISOString(),
          message,
          refreshing: false,
          status: "failed",
        });
      }
      if (!options.silent) {
        actionError.value = message;
      }
    } finally {
      if (scopedServiceId) {
        updateServiceHeartbeat(scopedServiceId, { refreshing: false });
      } else {
        refreshingRuntime.value = false;
      }
    }
  }

  async function adoptCandidateTools(serviceOrId: ExternalServiceEntry | string = "", toolNames: string[] = []) {
    const id = typeof serviceOrId === "string"
      ? String(serviceOrId || "").trim()
      : serviceHeartbeatKey(serviceOrId);
    if (!id || adoptingServiceIds.value[id]) {
      return;
    }
    const entry = typeof serviceOrId === "string"
      ? services.value.find((service) => service.serviceId === id)
      : serviceOrId;
    const selectedToolNames = uniqueNonEmptyStrings(toolNames);
    const expectedFingerprints = entry
      ? serviceCandidateToolFingerprintMap(entry, selectedToolNames)
      : {};
    adoptingServiceIds.value = {
      ...adoptingServiceIds.value,
      [id]: true,
    };
    actionError.value = "";
    actionMessage.value = "";
    try {
      const result = await adoptExternalServiceTools({
        serviceId: id,
        toolNames: selectedToolNames,
        adoptAll: selectedToolNames.length === 0,
        adoptedBy: "operator",
        expectedFingerprints,
      });
      if (!result.ok) {
        actionError.value = result.error || "候选工具采纳失败。";
        return;
      }
      const adoptedNames = result.adoptedToolNames || [];
      actionMessage.value = adoptedNames.length
        ? `已采纳 ${adoptedNames.length} 个候选工具。`
        : "没有新的候选工具需要采纳。";
      if (result.state) {
        state.value = result.state;
        activeValidation.value = validationFromState(result.state);
        reconcileServiceHeartbeats(result.state.services || []);
      } else {
        await refreshExternalServices();
      }
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error);
    } finally {
      const next = { ...adoptingServiceIds.value };
      delete next[id];
      adoptingServiceIds.value = next;
    }
  }

  async function saveConfig() {
    saving.value = true;
    actionError.value = "";
    actionMessage.value = "";
    try {
      const result = await saveExternalServiceConfig(configText.value);
      activeValidation.value = result.validation;
      if (!result.ok) {
        actionError.value = result.error || "配置保存失败。";
        return;
      }
      dirty.value = false;
      actionMessage.value = "配置已保存。";
      configEditorOpen.value = false;
      await refreshExternalServices();
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error);
    } finally {
      saving.value = false;
    }
  }

  function updateRootField(field: keyof ExternalServiceConfig, value: string) {
    commitConfigDraft({
      ...configDraft.value,
      [field]: value,
    }, { markDirty: true });
  }

  function updateUpstreamField(
    field: "type" | "transport" | "url" | "baseUrl" | "eventFormat" | "endpointUrl" | "endpointRef" | "rootPath" | "secretRef" | "timeoutMs",
    value: string,
  ) {
    const upstream: NonNullable<ExternalServiceConfig["upstream"]> = {
      ...(configDraft.value.upstream || {}),
      [field]: field === "timeoutMs" ? numericOrNull(value) : value,
    };
    const type = normalizeServiceType(upstream.type || "");
    if ((field === "url" || field === "baseUrl") && isHttpJsonType(type)) {
      upstream.baseUrl = value;
      upstream.url = value;
    }
    if ((field === "url" || field === "baseUrl") && isJsonRpcType(type)) {
      upstream.url = value;
      upstream.baseUrl = "";
    }
    commitConfigDraft({
      ...configDraft.value,
      templateId: templateIdForUpstream(upstream),
      binding: {
        ...(configDraft.value.binding || {}),
        mode: bindingModeForUpstream(upstream),
        outlet: SERVICE_HUB_OUTLET,
      },
      upstream,
    }, { markDirty: true });
  }

  function updateUpstreamTypeSelection(value: string) {
    const nextUpstream: NonNullable<ExternalServiceConfig["upstream"]> = {
      ...(configDraft.value.upstream || {}),
      type: value,
    };
    if (value !== "cloud-drive") {
      nextUpstream.providers = [];
      nextUpstream.mode = "";
      nextUpstream.endpointUrl = "";
      nextUpstream.endpointRef = "";
      nextUpstream.rootPath = "";
      nextUpstream.secretRef = "";
    }
    if (value !== "llm") {
      nextUpstream.modelProtocol = "";
      if (value !== "cloud-drive") {
        nextUpstream.provider = "";
      }
    }
    if (value !== "sse") {
      nextUpstream.eventFormat = "";
    }
    if (value === "mcp") {
      nextUpstream.transport = nextUpstream.transport === "sse" ? "sse" : "streamable-http";
      nextUpstream.url = nextUpstream.url || nextUpstream.baseUrl || "";
      nextUpstream.baseUrl = "";
    }
    if (value === "http" || value === "https" || value === "json-rpc" || value === "rpc") {
      nextUpstream.transport = "http";
      if (value === "http" || value === "https") {
        nextUpstream.baseUrl = nextUpstream.baseUrl || nextUpstream.url || "";
        nextUpstream.url = nextUpstream.baseUrl;
      } else {
        nextUpstream.url = nextUpstream.url || nextUpstream.baseUrl || "";
        nextUpstream.baseUrl = "";
      }
    }
    if (value === "sse") {
      nextUpstream.transport = "sse";
      nextUpstream.url = nextUpstream.url || nextUpstream.baseUrl || "";
      nextUpstream.baseUrl = "";
      nextUpstream.eventFormat = nextUpstream.eventFormat || "json-data";
    }
    const nextConfig: ExternalServiceConfig = {
      ...configDraft.value,
      upstream: nextUpstream,
    };
    if (value === "cloud-drive") {
      nextUpstream.transport = "pact-upstream-gateway";
      nextUpstream.provider = nextUpstream.provider || "icloud";
      nextUpstream.mode = nextUpstream.mode || "local";
      nextConfig.binding = {
        ...(nextConfig.binding || {}),
        outlet: SERVICE_HUB_OUTLET,
        requiredScopes: ["drive:read", "drive:write", "drive:sync", "drive:share"],
        risk: "safe_write",
      };
    }
    nextConfig.templateId = templateIdForUpstream(nextUpstream);
    nextConfig.binding = {
      ...(nextConfig.binding || {}),
      mode: bindingModeForUpstream(nextUpstream),
      outlet: SERVICE_HUB_OUTLET,
    };
    commitConfigDraft(ensurePrimaryToolForType(nextConfig, normalizeServiceType(value)), { markDirty: true });
  }

  function updateCustomUpstreamType(value: string) {
    updateUpstreamTypeSelection(String(value || "").trim() || "other");
  }

  function updateModelProtocol(value: string) {
    const upstream = {
      ...(configDraft.value.upstream || {}),
      type: "llm",
      modelProtocol: value,
    };
    commitConfigDraft({
      ...configDraft.value,
      templateId: templateIdForUpstream(upstream),
      binding: {
        ...(configDraft.value.binding || {}),
        mode: bindingModeForUpstream(upstream),
        outlet: SERVICE_HUB_OUTLET,
      },
      upstream,
    }, { markDirty: true });
  }

  function updateModelProvider(value: string) {
    const upstream = {
      ...(configDraft.value.upstream || {}),
      type: "llm",
      provider: value,
    };
    commitConfigDraft({
      ...configDraft.value,
      templateId: templateIdForUpstream(upstream),
      binding: {
        ...(configDraft.value.binding || {}),
        mode: bindingModeForUpstream(upstream),
        outlet: SERVICE_HUB_OUTLET,
      },
      upstream,
    }, { markDirty: true });
  }

  function updateUpstreamAuthField(field: "type" | "secretRef" | "headerName", value: string) {
    const currentAuth = isPlainObject(configDraft.value.upstream?.auth)
      ? configDraft.value.upstream?.auth as Record<string, unknown>
      : {};
    const auth = {
      ...currentAuth,
      [field]: value,
    };
    const compactedAuth = compactEmptyValues(auth);
    commitConfigDraft({
      ...configDraft.value,
      upstream: {
        ...(configDraft.value.upstream || {}),
        auth: compactedAuth ? compactedAuth as Record<string, unknown> : null,
      },
    }, { markDirty: true });
  }

	  function updatePrimaryToolField(field: "name" | "method" | "path", value: string) {
    const type = normalizeServiceType(configDraft.value.upstream?.type || "");
    const defaultTool = defaultToolForUpstreamType(type) || {};
    const current = isPlainObject(configDraft.value.tools?.[0])
      ? configDraft.value.tools?.[0] as Record<string, unknown>
      : {};
    const nextTool = {
      ...defaultTool,
      ...current,
      [field]: field === "method" && isHttpJsonType(type) ? value.toUpperCase() : value,
    };
    commitConfigDraft({
      ...configDraft.value,
      tools: [
        nextTool,
        ...(Array.isArray(configDraft.value.tools) ? configDraft.value.tools.slice(1) : []),
      ],
    }, { markDirty: true });
	  }

	  function updateAdvancedOptionalField(pathText: string, value: string) {
	    commitConfigDraft(setOptionalFieldValue(configDraft.value, pathText, value), { markDirty: true });
	  }

  function updateCloudDriveProvider(value: string) {
    const provider = String(value || "").trim();
    const isLocalProjectionProvider = provider === "icloud" || provider === "onedrive";
    const currentMode = configDraft.value.upstream?.mode;
    const mode = isLocalProjectionProvider
      ? (currentMode === "remote-live" ? "remote-live" : "local")
      : (currentMode === "local" ? "contract" : currentMode || "contract");
    commitConfigDraft({
      ...configDraft.value,
      templateId: templateIdForUpstream({ type: "cloud-drive" }),
      binding: {
        ...(configDraft.value.binding || {}),
        outlet: SERVICE_HUB_OUTLET,
      },
      upstream: {
        ...(configDraft.value.upstream || {}),
        type: "cloud-drive",
        provider,
        providers: provider ? [provider] : [],
        mode,
        transport: "pact-upstream-gateway",
      },
    }, { markDirty: true });
  }

  function updateCloudDriveMode(value: string) {
    commitConfigDraft({
      ...configDraft.value,
      templateId: templateIdForUpstream({ type: "cloud-drive" }),
      binding: {
        ...(configDraft.value.binding || {}),
        outlet: SERVICE_HUB_OUTLET,
      },
      upstream: {
        ...(configDraft.value.upstream || {}),
        type: "cloud-drive",
        mode: value,
        transport: "pact-upstream-gateway",
      },
    }, { markDirty: true });
  }

  function updateBindingField(field: "mode" | "outlet" | "risk", value: string) {
    commitConfigDraft({
      ...configDraft.value,
      binding: {
        ...(configDraft.value.binding || {}),
        [field]: value,
      },
    }, { markDirty: true });
  }

  function updateRequiredScopes(value: string) {
    requiredScopesText.value = value;
    commitConfigDraft({
      ...configDraft.value,
      binding: {
        ...(configDraft.value.binding || {}),
        requiredScopes: uniqueListFromText(value),
      },
    }, { markDirty: true });
  }

  function updateHealthCheckField(field: "type" | "url" | "host" | "port" | "path" | "timeoutMs", value: string) {
    commitConfigDraft({
      ...configDraft.value,
      healthCheck: {
        ...(configDraft.value.healthCheck || {}),
        [field]: field === "port" || field === "timeoutMs" ? numericOrNull(value) : value,
      },
    }, { markDirty: true });
  }

  function updateHealthCheckRequired(value: boolean) {
    commitConfigDraft({
      ...configDraft.value,
      healthCheck: {
        ...(configDraft.value.healthCheck || {}),
        required: value,
      },
    }, { markDirty: true });
  }

  function onConfigInput(value: string) {
    configText.value = value;
    dirty.value = true;
    try {
      const parsed = JSON.parse(value || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const normalized = normalizeConfigDraft(parsed as ExternalServiceConfig);
        configDraft.value = normalized;
        requiredScopesText.value = scopesTextFromConfig(normalized);
      }
    } catch {
      // Keep editing raw JSON; validation will report parse errors.
    }
  }

  function serviceSourceDetail(entry: ExternalServiceEntry) {
    return [entry.sourceLabel, entry.serviceId].filter(Boolean).join(" / ") || "-";
  }

  function upstreamTargetLabel(entry: ExternalServiceEntry) {
    return resolveUpstreamTarget(entry).label;
  }

  function upstreamTargetDetailLabel(entry: ExternalServiceEntry) {
    return resolveUpstreamTarget(entry).detail;
  }

  function serviceDiscoveryLabel(entry: ExternalServiceEntry) {
    return serviceTypeTag(entry).label;
  }

  function serviceDiscoveryTone(entry: ExternalServiceEntry) {
    return serviceTypeTag(entry).tone;
  }

  function serviceDiscoveryRegistrationLabel(entry: ExternalServiceEntry) {
    const tag = serviceTypeTag(entry);
    const upstream = serviceUpstream(entry);
    if (tag.type === "mcp") {
      return entry.externalMcp ? "工具已发现" : "工具待刷新";
    }
    if (tag.type === "llm") {
      return "模型已注册";
    }
    if (tag.type === "cloud-drive") {
      return "网盘已注册";
    }
    if (upstream?.url) {
      return "端点已注册";
    }
    if (tag.rawType && tag.type !== "other") {
      return "类型已注册";
    }
    return "服务已注册";
  }

  function serviceDiscoveryRegistrationTone(entry: ExternalServiceEntry) {
    const tag = serviceTypeTag(entry);
    if (tag.type === "mcp" && !entry.externalMcp) {
      return "warning";
    }
    return "success";
  }

  function serviceHeartbeat(entry: ExternalServiceEntry) {
    return serviceHeartbeats.value[serviceHeartbeatKey(entry)] || emptyServiceHeartbeat();
  }

  function serviceHeartbeatLastAtLabel(entry: ExternalServiceEntry) {
    const lastAt = serviceHeartbeat(entry).lastAt;
    return lastAt ? `Latest: ${formatCompactDateTime(lastAt)}` : "Latest: -";
  }

  function isServiceHeartbeatRefreshing(entry: ExternalServiceEntry) {
    return serviceHeartbeat(entry).refreshing === true;
  }

  onMounted(() => {
    void refreshExternalServices();
  });

  onBeforeUnmount(() => {
    clearServiceHeartbeatTimers();
  });

  usePageRefreshHandler(
    (detail) => detail.viewId === "externalServices",
    refreshExternalServices,
  );

  return proxyRefs({
    actionError,
    actionMessage,
    adoptCandidateTools,
	    activeConfigSummary,
	    activeTab,
	    activeValidation,
	    advancedOptionalFieldRows,
    bindingModeOptions: externalServiceBindingModeOptions,
    bindingOutletOptions: externalServiceBindingOutletOptions,
    closeConfigEditor,
    configDraft,
    configEditorMode,
    configEditorOpen,
    configEditorSubtitle,
    configEditorTitle,
    configStatusLabel,
    configStatusTone,
    configText,
    configuredCount,
    customUpstreamTypeValue,
    currentTemplateLabel,
    defaultedFieldLabels,
    dirty,
    discoveredServiceCount,
    discoveryCacheUpdatedAtLabel,
    healthCheckTypeOptions: externalServiceHealthCheckTypeOptions,
    cloudDriveModeOptions: externalServiceCloudDriveModeOptions,
    cloudDriveProviderOptions: externalServiceCloudDriveProviderOptions,
    endpointFieldLabel,
    endpointFieldPlaceholder,
    endpointFieldValue,
    httpMethodOptions: HTTP_METHOD_OPTIONS,
    isCloudDriveServiceDraft,
    isHttpJsonServiceDraft,
    isJsonRpcServiceDraft,
    isLlmServiceDraft,
    isMcpServiceDraft,
    isSseServiceDraft,
    loadError,
    loading,
    minimumFieldLabels,
    mcpTransportOptions: externalServiceMcpTransportOptions,
    modelProtocolOptions: externalServiceModelProtocolOptions,
    modelProtocolSelectValue,
    mcpToolCount,
    modeOptions: externalServiceModeOptions,
    onConfigInput,
    openAddServiceConfig,
    openEditServiceConfig,
    presetCount,
    primaryHttpMethod,
    primaryHttpPath,
    primaryRpcMethod,
    primaryToolName,
    refreshExternalServices,
    refreshingRuntime,
    refreshRuntime,
    registryPath,
    requiredScopesText,
    requiredFieldGroupSummaries,
    riskOptions: externalServiceRiskOptions,
    saveConfig,
    saving,
    serviceSourceDetail,
    serviceDiscoveryLabel,
    serviceDiscoveryRegistrationLabel,
    serviceDiscoveryRegistrationTone,
    serviceDiscoveryTone,
    serviceActiveToolCount,
    serviceCandidateToolCount,
    serviceActiveToolReviewRows,
    serviceCandidateToolReviewRows,
    serviceCandidateToolFingerprintMap,
    serviceHeartbeatLastAtLabel,
    serviceToolAdoptionLabel,
    services,
    isServiceToolAdopting,
    isServiceHeartbeatRefreshing,
    optionalFieldGroupSummaries,
    showCustomUpstreamType,
    showMcpTransportField,
    showToolMappingFields,
    startupPolicyOptions: externalServiceStartupPolicyOptions,
	    updateBindingField,
	    updateAdvancedOptionalField,
    updateHealthCheckField,
    updateHealthCheckRequired,
    updateModelProtocol,
    updateModelProvider,
    updateCloudDriveMode,
    updateCloudDriveProvider,
    updatePrimaryToolField,
    updateRequiredScopes,
    updateRootField,
    updateUpstreamAuthField,
    updateCustomUpstreamType,
    updateUpstreamField,
    updateUpstreamTypeSelection,
    upstreamAuthHeaderName,
    upstreamAuthSecretRef,
    upstreamAuthType,
    upstreamTypeSelectValue,
    upstreamTargetDetailLabel,
    upstreamTargetLabel,
    upstreamTypeOptions: externalServiceUpstreamTypeOptions,
    validServiceCount,
    validationErrors,
    validationWarnings,
    verifyConfig,
    verifying,
  });
}
