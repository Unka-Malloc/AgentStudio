import fs from "node:fs/promises";
import path from "node:path";
import { assertExternalServiceEgressAllowed } from "./external-service-egress-policy.mjs";
import { parseExplicitHttpUrl } from "./external-mcp-passthrough-runtime.mjs";

export const EXTERNAL_SERVICE_CONFIG_KIND = "pact.external-service.config";
export const EXTERNAL_SERVICE_MODE = Object.freeze({
  MANAGED: "managed",
  CONNECTED: "connected",
  ON_DEMAND: "on-demand"
});
export const EXTERNAL_SERVICE_MODE_VALUES = Object.freeze(Object.values(EXTERNAL_SERVICE_MODE));
export const EXTERNAL_SERVICE_STARTUP_POLICY = Object.freeze({
  WITH_PLATFORM: "with-platform",
  ON_DEMAND: "on-demand",
  EXTERNAL_ONLY: "external-only"
});
export const EXTERNAL_SERVICE_STARTUP_POLICY_VALUES = Object.freeze(Object.values(EXTERNAL_SERVICE_STARTUP_POLICY));
export const EXTERNAL_SERVICE_UPSTREAM_TYPE = Object.freeze({
  MCP: "mcp",
  ACP: "acp",
  LLM: "llm",
  CLOUD_DRIVE: "cloud-drive",
  HTTP: "http",
  HTTPS: "https",
  JSON_RPC: "json-rpc",
  SSE: "sse",
  OPENAPI: "openapi",
  RPC: "rpc",
  OPENAI: "openai",
  OTHER: "other"
});
export const EXTERNAL_SERVICE_UPSTREAM_TYPE_VALUES = Object.freeze(Object.values(EXTERNAL_SERVICE_UPSTREAM_TYPE));
export const EXTERNAL_SERVICE_CLOUD_DRIVE_PROVIDER = Object.freeze({
  ICLOUD: "icloud",
  ONEDRIVE: "onedrive",
  GOOGLE_DRIVE: "google-drive",
  DROPBOX: "dropbox"
});
export const EXTERNAL_SERVICE_CLOUD_DRIVE_PROVIDER_VALUES = Object.freeze(Object.values(EXTERNAL_SERVICE_CLOUD_DRIVE_PROVIDER));
export const EXTERNAL_SERVICE_CLOUD_DRIVE_MODE = Object.freeze({
  LOCAL: "local",
  CONTRACT: "contract",
  REMOTE_LIVE: "remote-live"
});
export const EXTERNAL_SERVICE_CLOUD_DRIVE_MODE_VALUES = Object.freeze(Object.values(EXTERNAL_SERVICE_CLOUD_DRIVE_MODE));
export const EXTERNAL_SERVICE_MODEL_PROTOCOL = Object.freeze({
  OPENAI_COMPATIBLE: "openai-compatible",
  OPENAI_RESPONSES: "openai-responses",
  ANTHROPIC_MESSAGES: "anthropic-messages",
  GEMINI_GENERATE_CONTENT: "gemini-generate-content",
  BEDROCK_CONVERSE: "bedrock-converse",
  COHERE_CHAT: "cohere-chat",
  OLLAMA_NATIVE: "ollama-native",
  DASHSCOPE_NATIVE: "dashscope-native",
  HUGGINGFACE_TGI: "huggingface-tgi",
  AZURE_AI_INFERENCE: "azure-ai-inference",
  VERTEX_AI_PREDICTION: "vertex-ai-prediction",
  CUSTOM_JSON_HTTP: "custom-json-http"
});
export const EXTERNAL_SERVICE_MODEL_PROTOCOL_VALUES = Object.freeze(Object.values(EXTERNAL_SERVICE_MODEL_PROTOCOL));
export const EXTERNAL_SERVICE_MCP_TRANSPORT = Object.freeze({
  STREAMABLE_HTTP: "streamable-http",
  HTTP: "http",
  SSE: "sse",
  STDIO: "stdio"
});
export const EXTERNAL_SERVICE_MCP_TRANSPORT_VALUES = Object.freeze(Object.values(EXTERNAL_SERVICE_MCP_TRANSPORT));
export const EXTERNAL_SERVICE_ACP_TRANSPORT = Object.freeze({
  STDIO: "stdio",
  HTTP: "http",
  STREAMABLE_HTTP: "streamable-http",
  WEBSOCKET: "websocket"
});
export const EXTERNAL_SERVICE_ACP_TRANSPORT_VALUES = Object.freeze(Object.values(EXTERNAL_SERVICE_ACP_TRANSPORT));
export const EXTERNAL_SERVICE_BINDING_MODE = Object.freeze({
  PASSTHROUGH: "passthrough",
  COMPILE: "compile"
});
export const EXTERNAL_SERVICE_BINDING_MODE_VALUES = Object.freeze(Object.values(EXTERNAL_SERVICE_BINDING_MODE));
export const EXTERNAL_SERVICE_BINDING_OUTLET = Object.freeze({
  SERVICE_HUB: "pact.serviceHub",
  SKILL_HUB: "pact.skillHub",
  AGENT_RELAY: "pact.agentRelay"
});
export const EXTERNAL_SERVICE_BINDING_OUTLET_VALUES = Object.freeze(Object.values(EXTERNAL_SERVICE_BINDING_OUTLET));
export const EXTERNAL_SERVICE_TEMPLATE_ID = Object.freeze({
  RAW_MCP_STREAMABLE_HTTP: "external-service.template.raw-mcp-streamable-http",
  RAW_MCP_SSE: "external-service.template.raw-mcp-sse",
  HTTP_JSON: "external-service.template.http-json",
  HTTPS_JSON: "external-service.template.https-json",
  JSON_RPC: "external-service.template.json-rpc",
  SSE: "external-service.template.sse",
  OPENAI_MODEL_GATEWAY: "external-service.template.openai-model-gateway"
});
export const EXTERNAL_SERVICE_TEMPLATE_ID_VALUES = Object.freeze(Object.values(EXTERNAL_SERVICE_TEMPLATE_ID));
export const EXTERNAL_SERVICE_POLICY_PRESET = Object.freeze({
  PRODUCTION_DEFAULT: "servicehub.production-default",
  DEVELOPMENT_LOCAL: "servicehub.development-local",
  READONLY_MINIMAL: "servicehub.readonly-minimal"
});
export const EXTERNAL_SERVICE_POLICY_PRESET_VALUES = Object.freeze(Object.values(EXTERNAL_SERVICE_POLICY_PRESET));
export const EXTERNAL_SERVICE_RISK = Object.freeze({
  READ_ONLY: "read_only",
  SAFE_WRITE: "safe_write",
  REPAIR_WRITE: "repair_write",
  DESTRUCTIVE: "destructive"
});
export const EXTERNAL_SERVICE_RISK_VALUES = Object.freeze(Object.values(EXTERNAL_SERVICE_RISK));
export const EXTERNAL_SERVICE_HEALTH_CHECK_TYPE = Object.freeze({
  NONE: "none",
  HTTP: "http"
});
export const EXTERNAL_SERVICE_HEALTH_CHECK_TYPE_VALUES = Object.freeze(Object.values(EXTERNAL_SERVICE_HEALTH_CHECK_TYPE));

const DEFAULT_CORE_FEATURE_IDS = Object.freeze([
  "core-platform",
  "security-permissions",
  "operation-dispatcher",
  "console-shell",
  "storage-core",
  "module-management-core",
  "data-structure-core",
  "devops-core",
  "tool-management-core"
]);

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function enumValue(value, values, fallback) {
  const normalized = String(value || "").trim();
  return values.includes(normalized) ? normalized : fallback;
}

function normalizedToken(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function isHttpUrlText(value = "") {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isHttpLikeUpstreamType(value = "") {
  return [
    EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTP,
    EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTPS,
    EXTERNAL_SERVICE_UPSTREAM_TYPE.OPENAPI,
    EXTERNAL_SERVICE_UPSTREAM_TYPE.RPC,
    EXTERNAL_SERVICE_UPSTREAM_TYPE.JSON_RPC,
    EXTERNAL_SERVICE_UPSTREAM_TYPE.SSE,
    EXTERNAL_SERVICE_UPSTREAM_TYPE.LLM
  ].includes(String(value || "").trim());
}

function isCompileTemplateUpstreamType(value = "") {
  return [
    EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTP,
    EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTPS,
    EXTERNAL_SERVICE_UPSTREAM_TYPE.OPENAPI,
    EXTERNAL_SERVICE_UPSTREAM_TYPE.RPC,
    EXTERNAL_SERVICE_UPSTREAM_TYPE.JSON_RPC,
    EXTERNAL_SERVICE_UPSTREAM_TYPE.SSE,
    EXTERNAL_SERVICE_UPSTREAM_TYPE.LLM
  ].includes(String(value || "").trim());
}

function isSensitiveHeaderName(value = "") {
  const headerName = String(value || "").trim().toLowerCase();
  return [
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "api-key",
    "apikey",
    "x-auth-token",
    "x-access-token"
  ].includes(headerName);
}

function isLiteralCredentialHeaderValue(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }
  return /^\s*(bearer|basic)\s+\S+/i.test(text) ||
    /\b(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|secret)\s*[:=]\s*\S+/i.test(text) ||
    /\b(sk-[a-z0-9][a-z0-9_-]{12,}|ghp_[a-z0-9_]{16,}|xox[baprs]-[a-z0-9-]{10,})\b/i.test(text) ||
    /^secret:\/\//i.test(text);
}

function parseUrl(value = "") {
  try {
    return new URL(String(value || "").trim());
  } catch {
    return null;
  }
}

function urlHasExplicitPath(value = "") {
  const url = parseUrl(value);
  return Boolean(url?.pathname && url.pathname !== "/");
}

function rpcEndpointEntries(config = {}) {
  const upstream = asObject(config.upstream);
  const rawEndpoints = upstream.endpoints || upstream.rpcEndpoints || {};
  if (Array.isArray(rawEndpoints)) {
    return rawEndpoints
      .map((endpoint) => asObject(endpoint, null))
      .filter(Boolean)
      .map((endpoint) => ({
        ...endpoint,
        id: String(endpoint.id || endpoint.name || endpoint.ref || endpoint.key || "").trim()
      }))
      .filter((endpoint) => endpoint.id);
  }
  return Object.entries(asObject(rawEndpoints))
    .map(([id, endpoint]) => {
      if (typeof endpoint === "string") {
        return { id, url: endpoint };
      }
      return {
        ...asObject(endpoint),
        id: String(asObject(endpoint).id || id).trim()
      };
    })
    .filter((endpoint) => endpoint.id);
}

function rpcEndpointByRef(config = {}, endpointRef = "") {
  const ref = String(endpointRef || "").trim();
  if (!ref) {
    return null;
  }
  return rpcEndpointEntries(config).find((endpoint) => endpoint.id === ref) || null;
}

function hasExplicitRpcPath(config = {}, tool = {}) {
  const upstream = asObject(config.upstream);
  const rpc = asObject(tool.rpc);
  const endpointRef = String(rpc.endpointRef || rpc.endpoint || rpc.endpointId || "").trim();
  const endpoint = rpcEndpointByRef(config, endpointRef);
  return Boolean(
    urlHasExplicitPath(rpc.url || "") ||
    String(upstream.path || upstream.rpcPath || "").trim() ||
    String(rpc.path || "").trim() ||
    String(endpoint?.path || endpoint?.rpcPath || "").trim() ||
    urlHasExplicitPath(endpoint?.url || endpoint?.baseUrl || "") ||
    urlHasExplicitPath(upstream.url || upstream.baseUrl || "")
  );
}

function normalizeModelProtocol(value = "") {
  const protocol = normalizedToken(value);
  switch (protocol) {
    case "openai":
    case "openai-chat":
    case "openai-chat-completions":
    case "chat-completions":
    case "mistral-chat-completions":
      return EXTERNAL_SERVICE_MODEL_PROTOCOL.OPENAI_COMPATIBLE;
    case "responses":
    case "openai-response":
      return EXTERNAL_SERVICE_MODEL_PROTOCOL.OPENAI_RESPONSES;
    case "anthropic":
    case "claude":
    case "anthropic-message":
      return EXTERNAL_SERVICE_MODEL_PROTOCOL.ANTHROPIC_MESSAGES;
    case "gemini":
    case "google-gemini":
    case "generate-content":
      return EXTERNAL_SERVICE_MODEL_PROTOCOL.GEMINI_GENERATE_CONTENT;
    case "bedrock":
    case "aws-bedrock":
      return EXTERNAL_SERVICE_MODEL_PROTOCOL.BEDROCK_CONVERSE;
    case "cohere":
      return EXTERNAL_SERVICE_MODEL_PROTOCOL.COHERE_CHAT;
    case "ollama":
      return EXTERNAL_SERVICE_MODEL_PROTOCOL.OLLAMA_NATIVE;
    case "dashscope":
    case "qwen-dashscope":
      return EXTERNAL_SERVICE_MODEL_PROTOCOL.DASHSCOPE_NATIVE;
    case "hf-tgi":
    case "tgi":
    case "text-generation-inference":
      return EXTERNAL_SERVICE_MODEL_PROTOCOL.HUGGINGFACE_TGI;
    case "azure":
    case "azure-ai":
    case "azure-model-inference":
      return EXTERNAL_SERVICE_MODEL_PROTOCOL.AZURE_AI_INFERENCE;
    case "vertex":
    case "vertex-ai":
      return EXTERNAL_SERVICE_MODEL_PROTOCOL.VERTEX_AI_PREDICTION;
    case "custom":
    case "json-http":
      return EXTERNAL_SERVICE_MODEL_PROTOCOL.CUSTOM_JSON_HTTP;
    default:
      return protocol;
  }
}

function inferModelProviderFromHost(host = "") {
  if (!host) {
    return "";
  }
  if (host === "openai.com" || host.endsWith(".openai.com")) return "openai";
  if (host === "anthropic.com" || host.endsWith(".anthropic.com")) return "anthropic";
  if (host.includes("generativelanguage.googleapis.com")) return "google";
  if (host.includes("aiplatform.googleapis.com")) return "google-vertex";
  if (host.includes("bedrock-runtime.")) return "aws-bedrock";
  if (host === "cohere.com" || host.endsWith(".cohere.com")) return "cohere";
  if (host.includes("dashscope")) return "dashscope";
  if (host.includes("huggingface.co") || host.includes("endpoints.huggingface.cloud")) return "huggingface";
  if (host.endsWith(".services.ai.azure.com")) return "azure-ai";
  if (host.includes("moonshot")) return "moonshot";
  if (host.includes("deepseek")) return "deepseek";
  if (host.includes("hunyuan")) return "tencent-hunyuan";
  if (host.includes("baiduqianfan") || host.includes("qianfan")) return "baidu-qianfan";
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "";
  return "";
}

function inferModelProtocolFromUrl(urlText = "", provider = "") {
  const url = parseUrl(urlText);
  const host = url?.hostname.toLowerCase() || "";
  const pathName = url?.pathname.toLowerCase() || "";
  if (pathName.includes("/responses")) return EXTERNAL_SERVICE_MODEL_PROTOCOL.OPENAI_RESPONSES;
  if (pathName.includes("/chat/completions") || pathName.includes("/compatible-mode/v1")) {
    return EXTERNAL_SERVICE_MODEL_PROTOCOL.OPENAI_COMPATIBLE;
  }
  if (host === "api.anthropic.com" || pathName.includes("/v1/messages")) {
    return EXTERNAL_SERVICE_MODEL_PROTOCOL.ANTHROPIC_MESSAGES;
  }
  if (host.includes("generativelanguage.googleapis.com") || pathName.includes(":generatecontent")) {
    return EXTERNAL_SERVICE_MODEL_PROTOCOL.GEMINI_GENERATE_CONTENT;
  }
  if (host.includes("aiplatform.googleapis.com")) {
    return EXTERNAL_SERVICE_MODEL_PROTOCOL.VERTEX_AI_PREDICTION;
  }
  if (host.includes("bedrock-runtime.") || pathName.endsWith("/converse")) {
    return EXTERNAL_SERVICE_MODEL_PROTOCOL.BEDROCK_CONVERSE;
  }
  if (host === "api.cohere.com" || provider === "cohere") {
    return EXTERNAL_SERVICE_MODEL_PROTOCOL.COHERE_CHAT;
  }
  if (pathName === "/api/chat" || pathName === "/api/generate") {
    return EXTERNAL_SERVICE_MODEL_PROTOCOL.OLLAMA_NATIVE;
  }
  if (pathName.includes("/api/v1/services/aigc/")) {
    return EXTERNAL_SERVICE_MODEL_PROTOCOL.DASHSCOPE_NATIVE;
  }
  if (host.includes("huggingface.co") || host.includes("endpoints.huggingface.cloud")) {
    return EXTERNAL_SERVICE_MODEL_PROTOCOL.HUGGINGFACE_TGI;
  }
  if (host.endsWith(".services.ai.azure.com")) {
    return EXTERNAL_SERVICE_MODEL_PROTOCOL.AZURE_AI_INFERENCE;
  }
  return "";
}

function normalizeModelDescriptor(input = {}, rawType = "") {
  const explicitProtocol = normalizeModelProtocol(input.modelProtocol || input.model_protocol || input.protocol);
  const urlText = String(input.url || "").trim();
  const url = parseUrl(urlText);
  const provider = normalizedToken(input.provider || input.vendor || input.metadata?.provider) ||
    inferModelProviderFromHost(url?.hostname.toLowerCase() || "");
  const isModelType = rawType === EXTERNAL_SERVICE_UPSTREAM_TYPE.LLM;
  const inferredProtocol =
    explicitProtocol ||
    inferModelProtocolFromUrl(urlText, provider);
  if (!isModelType && !explicitProtocol && !provider && !inferredProtocol) {
    return null;
  }
  return {
    type: EXTERNAL_SERVICE_UPSTREAM_TYPE.LLM,
    provider,
    modelProtocol: inferredProtocol || EXTERNAL_SERVICE_MODEL_PROTOCOL.CUSTOM_JSON_HTTP
  };
}

function normalizeCloudDriveProvider(value = "") {
  const provider = normalizedToken(value);
  switch (provider) {
    case "one-drive":
    case "microsoft-onedrive":
    case "microsoft-drive":
      return EXTERNAL_SERVICE_CLOUD_DRIVE_PROVIDER.ONEDRIVE;
    case "google":
    case "googledrive":
    case "google-drive":
      return EXTERNAL_SERVICE_CLOUD_DRIVE_PROVIDER.GOOGLE_DRIVE;
    case "icloud-drive":
    case "apple-icloud":
      return EXTERNAL_SERVICE_CLOUD_DRIVE_PROVIDER.ICLOUD;
    default:
      return provider;
  }
}

function normalizeCloudDriveMode(value = "") {
  const mode = normalizedToken(value);
  switch (mode) {
    case "live":
    case "remote":
    case "remote-live":
      return EXTERNAL_SERVICE_CLOUD_DRIVE_MODE.REMOTE_LIVE;
    case "local-directory":
    case "local":
      return EXTERNAL_SERVICE_CLOUD_DRIVE_MODE.LOCAL;
    case "contract-mode":
    case "contract":
      return EXTERNAL_SERVICE_CLOUD_DRIVE_MODE.CONTRACT;
    default:
      return "";
  }
}

function normalizeCloudDriveDescriptor(input = {}) {
  const provider = normalizeCloudDriveProvider(input.provider || input.driveProvider || input.vendor || "");
  const providers = uniqueStrings([
    provider,
    ...asArray(input.providers || input.driveProviders).map(normalizeCloudDriveProvider)
  ]).filter((item) => EXTERNAL_SERVICE_CLOUD_DRIVE_PROVIDER_VALUES.includes(item));
  const localProjectionProvider = provider === EXTERNAL_SERVICE_CLOUD_DRIVE_PROVIDER.ICLOUD ||
    provider === EXTERNAL_SERVICE_CLOUD_DRIVE_PROVIDER.ONEDRIVE;
  const mode = normalizeCloudDriveMode(input.mode || input.adapterMode || input.requestedMode) ||
    (localProjectionProvider ? EXTERNAL_SERVICE_CLOUD_DRIVE_MODE.LOCAL : EXTERNAL_SERVICE_CLOUD_DRIVE_MODE.CONTRACT);
  const endpointUrl = String(input.endpointUrl || input.remoteEndpointUrl || input.baseUrl || input.url || "").trim();
  return {
    ...input,
    type: EXTERNAL_SERVICE_UPSTREAM_TYPE.CLOUD_DRIVE,
    provider,
    providers,
    mode,
    transport: String(input.transport || "pact-upstream-gateway").trim(),
    url: String(input.url || endpointUrl || "").trim(),
    endpointUrl,
    endpointRef: String(input.endpointRef || "").trim(),
    rootPath: String(input.rootPath || input.sourcePath || input.localPath || input.path || "").trim(),
    secretRef: String(input.secretRef || "").trim(),
    timeoutMs: input.timeoutMs === undefined ? null : Number(input.timeoutMs),
    metadata: asObject(input.metadata)
  };
}

function normalizedMode(value) {
  return enumValue(value, EXTERNAL_SERVICE_MODE_VALUES, EXTERNAL_SERVICE_MODE.CONNECTED);
}

function normalizedStartupPolicy(value, mode) {
  const fallback = mode === EXTERNAL_SERVICE_MODE.MANAGED
    ? EXTERNAL_SERVICE_STARTUP_POLICY.WITH_PLATFORM
    : EXTERNAL_SERVICE_STARTUP_POLICY.EXTERNAL_ONLY;
  return enumValue(value, EXTERNAL_SERVICE_STARTUP_POLICY_VALUES, fallback);
}

function normalizeScriptEntry(value, id) {
  if (!value) {
    return null;
  }
  const raw = typeof value === "string" ? { path: value } : asObject(value);
  const command = typeof raw.command === "string"
    ? { executable: raw.command, args: asArray(raw.args) }
    : asObject(raw.command, null);
  return {
    id,
    path: String(raw.path || raw.script || "").trim(),
    command: command
      ? {
          executable: String(command.executable || command.cmd || "").trim(),
          args: asArray(command.args)
        }
      : null,
    args: asArray(raw.args),
    cwd: String(raw.cwd || "").trim(),
    env: asObject(raw.env),
    required: raw.required !== false,
    longRunning: raw.longRunning === true,
    description: String(raw.description || "").trim()
  };
}

function normalizeCommand(value) {
  const raw = asObject(value, null);
  if (!raw) {
    return null;
  }
  return {
    executable: String(raw.executable || raw.command || raw.cmd || "").trim(),
    args: asArray(raw.args)
  };
}

function hasLocalLaunchDescriptor(value = {}) {
  const upstream = asObject(value);
  return Boolean(
    upstream.command?.executable ||
    asArray(upstream.command?.args).length > 0 ||
    asArray(upstream.args).length > 0 ||
    String(upstream.cwd || "").trim() ||
    Object.keys(asObject(upstream.env)).length > 0
  );
}

function upstreamDefaultsForTemplate(templateId = "") {
  switch (String(templateId || "").trim()) {
    case EXTERNAL_SERVICE_TEMPLATE_ID.RAW_MCP_STREAMABLE_HTTP:
      return {
        type: EXTERNAL_SERVICE_UPSTREAM_TYPE.MCP,
        transport: EXTERNAL_SERVICE_MCP_TRANSPORT.STREAMABLE_HTTP
      };
    case EXTERNAL_SERVICE_TEMPLATE_ID.RAW_MCP_SSE:
      return {
        type: EXTERNAL_SERVICE_UPSTREAM_TYPE.MCP,
        transport: EXTERNAL_SERVICE_MCP_TRANSPORT.SSE
      };
    case EXTERNAL_SERVICE_TEMPLATE_ID.HTTP_JSON:
      return { type: EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTP };
    case EXTERNAL_SERVICE_TEMPLATE_ID.HTTPS_JSON:
      return { type: EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTPS };
    case EXTERNAL_SERVICE_TEMPLATE_ID.JSON_RPC:
      return { type: EXTERNAL_SERVICE_UPSTREAM_TYPE.JSON_RPC };
    case EXTERNAL_SERVICE_TEMPLATE_ID.SSE:
      return { type: EXTERNAL_SERVICE_UPSTREAM_TYPE.SSE };
    case EXTERNAL_SERVICE_TEMPLATE_ID.OPENAI_MODEL_GATEWAY:
      return { type: EXTERNAL_SERVICE_UPSTREAM_TYPE.LLM };
    default:
      return {};
  }
}

function applyTemplateUpstreamDefaults(raw, templateId = "") {
  const input = asObject(raw, null);
  if (!input) {
    return raw;
  }
  const defaults = upstreamDefaultsForTemplate(templateId);
  if (Object.keys(defaults).length === 0) {
    return input;
  }
  return {
    ...defaults,
    ...input
  };
}

function normalizeUpstream(raw) {
  const input = asObject(raw, null);
  if (!input) {
    return null;
  }
  const type = String(input.type || "").trim();
  if (type === EXTERNAL_SERVICE_UPSTREAM_TYPE.MCP) {
    const rawTransport = String(input.transport || EXTERNAL_SERVICE_MCP_TRANSPORT.STREAMABLE_HTTP).trim();
    const transport = rawTransport === EXTERNAL_SERVICE_MCP_TRANSPORT.HTTP
      ? EXTERNAL_SERVICE_MCP_TRANSPORT.STREAMABLE_HTTP
      : rawTransport;
    return {
      type,
      transport,
      url: String(input.url || "").trim(),
	      auth: asObject(input.auth, null),
	      defaultHeaders: asObject(input.defaultHeaders),
	      command: normalizeCommand(input.command),
	      args: asArray(input.args),
	      cwd: String(input.cwd || "").trim(),
	      env: asObject(input.env),
	      timeoutMs: input.timeoutMs === undefined ? null : Number(input.timeoutMs),
	      metadata: asObject(input.metadata)
	    };
  }
  if (type === EXTERNAL_SERVICE_UPSTREAM_TYPE.ACP) {
    const transport = enumValue(
      input.transport,
      EXTERNAL_SERVICE_ACP_TRANSPORT_VALUES,
      EXTERNAL_SERVICE_ACP_TRANSPORT.STREAMABLE_HTTP
    );
    return {
      ...input,
      type,
      url: String(input.url || "").trim(),
      transport,
      command: normalizeCommand(input.command),
      timeoutMs: input.timeoutMs === undefined ? null : Number(input.timeoutMs),
      metadata: asObject(input.metadata)
    };
  }
  if (type === EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTP || type === EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTPS) {
    return {
      ...input,
      type,
      baseUrl: String(input.baseUrl || input.url || "").trim(),
      url: String(input.url || input.baseUrl || "").trim(),
      auth: asObject(input.auth, null),
      defaultHeaders: asObject(input.defaultHeaders),
      transport: "http",
      timeoutMs: input.timeoutMs === undefined ? null : Number(input.timeoutMs),
      metadata: asObject(input.metadata)
    };
  }
  if (type === EXTERNAL_SERVICE_UPSTREAM_TYPE.RPC) {
    return {
      ...input,
      type,
      protocol: String(input.protocol || "json-rpc-2.0").trim(),
      url: String(input.url || input.baseUrl || "").trim(),
      baseUrl: String(input.baseUrl || "").trim(),
      path: String(input.path || input.rpcPath || "").trim(),
      endpoints: Array.isArray(input.endpoints || input.rpcEndpoints)
        ? asArray(input.endpoints || input.rpcEndpoints)
        : asObject(input.endpoints || input.rpcEndpoints),
      auth: asObject(input.auth, null),
      defaultHeaders: asObject(input.defaultHeaders),
      transport: String(input.transport || "http").trim(),
      timeoutMs: input.timeoutMs === undefined ? null : Number(input.timeoutMs),
      metadata: asObject(input.metadata)
    };
  }
  if (type === EXTERNAL_SERVICE_UPSTREAM_TYPE.JSON_RPC) {
    return {
      ...input,
      type,
      protocol: "json-rpc-2.0",
      rpcVersion: String(input.rpcVersion || "2.0").trim(),
      url: String(input.url || input.baseUrl || "").trim(),
      baseUrl: String(input.baseUrl || "").trim(),
      path: String(input.path || input.rpcPath || "").trim(),
      endpoints: Array.isArray(input.endpoints || input.rpcEndpoints)
        ? asArray(input.endpoints || input.rpcEndpoints)
        : asObject(input.endpoints || input.rpcEndpoints),
      auth: asObject(input.auth, null),
      defaultHeaders: asObject(input.defaultHeaders),
      transport: String(input.transport || "http").trim(),
      timeoutMs: input.timeoutMs === undefined ? null : Number(input.timeoutMs),
      metadata: asObject(input.metadata)
    };
  }
  if (type === EXTERNAL_SERVICE_UPSTREAM_TYPE.SSE) {
    return {
      ...input,
      type,
      url: String(input.url || "").trim(),
      eventFormat: String(input.eventFormat || "json-data").trim(),
      auth: asObject(input.auth, null),
      defaultHeaders: asObject(input.defaultHeaders),
      transport: String(input.transport || "sse").trim(),
      timeoutMs: input.timeoutMs === undefined ? null : Number(input.timeoutMs),
      metadata: asObject(input.metadata)
    };
  }
  if (type === EXTERNAL_SERVICE_UPSTREAM_TYPE.CLOUD_DRIVE) {
    return normalizeCloudDriveDescriptor(input);
  }
  const modelDescriptor = normalizeModelDescriptor(input, type);
  if (modelDescriptor) {
    return {
      ...input,
      ...modelDescriptor,
      url: String(input.url || "").trim(),
      transport: String(input.transport || "http").trim(),
      timeoutMs: input.timeoutMs === undefined ? null : Number(input.timeoutMs),
      metadata: asObject(input.metadata)
    };
  }
  return {
    ...input,
    type: enumValue(type, EXTERNAL_SERVICE_UPSTREAM_TYPE_VALUES, type)
  };
}

function normalizeBinding(raw = {}, upstream = null) {
  const input = asObject(raw, null);
  const defaultMode = upstream?.type === EXTERNAL_SERVICE_UPSTREAM_TYPE.MCP
    ? EXTERNAL_SERVICE_BINDING_MODE.PASSTHROUGH
    : isCompileTemplateUpstreamType(upstream?.type)
      ? EXTERNAL_SERVICE_BINDING_MODE.COMPILE
      : EXTERNAL_SERVICE_BINDING_MODE.PASSTHROUGH;
  if (!input) {
    return {
      mode: defaultMode,
      outlet: EXTERNAL_SERVICE_BINDING_OUTLET.SERVICE_HUB,
      requiredScopes: [],
      risk: EXTERNAL_SERVICE_RISK.READ_ONLY,
      metadata: {}
    };
  }
  return {
    mode: enumValue(input.mode, EXTERNAL_SERVICE_BINDING_MODE_VALUES, defaultMode),
    outlet: enumValue(input.outlet, EXTERNAL_SERVICE_BINDING_OUTLET_VALUES, EXTERNAL_SERVICE_BINDING_OUTLET.SERVICE_HUB),
    requiredScopes: uniqueStrings(input.requiredScopes || input.scopes),
    risk: enumValue(input.risk, EXTERNAL_SERVICE_RISK_VALUES, EXTERNAL_SERVICE_RISK.READ_ONLY),
    metadata: asObject(input.metadata)
  };
}

function inferTemplateId(raw = {}, upstream = null) {
  const explicit = String(raw.templateId || raw.template || "").trim();
  if (explicit) {
    return explicit;
  }
  if (upstream?.type === EXTERNAL_SERVICE_UPSTREAM_TYPE.MCP) {
    return upstream.transport === EXTERNAL_SERVICE_MCP_TRANSPORT.SSE
      ? EXTERNAL_SERVICE_TEMPLATE_ID.RAW_MCP_SSE
      : EXTERNAL_SERVICE_TEMPLATE_ID.RAW_MCP_STREAMABLE_HTTP;
  }
  if (upstream?.type === EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTP) {
    return EXTERNAL_SERVICE_TEMPLATE_ID.HTTP_JSON;
  }
  if (upstream?.type === EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTPS) {
    return EXTERNAL_SERVICE_TEMPLATE_ID.HTTPS_JSON;
  }
  if (upstream?.type === EXTERNAL_SERVICE_UPSTREAM_TYPE.JSON_RPC || upstream?.type === EXTERNAL_SERVICE_UPSTREAM_TYPE.RPC) {
    return EXTERNAL_SERVICE_TEMPLATE_ID.JSON_RPC;
  }
  if (upstream?.type === EXTERNAL_SERVICE_UPSTREAM_TYPE.SSE) {
    return EXTERNAL_SERVICE_TEMPLATE_ID.SSE;
  }
  if (upstream?.type === EXTERNAL_SERVICE_UPSTREAM_TYPE.LLM) {
    return EXTERNAL_SERVICE_TEMPLATE_ID.OPENAI_MODEL_GATEWAY;
  }
  return "";
}

export function normalizeExternalServiceConfig(raw = {}, fallback = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const serviceId = String(raw.serviceId || raw.id || fallback.serviceId || fallback.presetId || "").trim();
  const mode = normalizedMode(raw.mode || fallback.mode);
  const scripts = {};
  for (const id of ["prepare", "start", "stop", "doctor", "smoke"]) {
    const entry = normalizeScriptEntry(raw.scripts?.[id] || raw[`${id}Script`] || raw[`${id}Command`], id);
    if (entry) {
      scripts[id] = entry;
    }
  }
  const healthCheck = asObject(raw.healthCheck || raw.health);
  const displayName = String(raw.displayName || fallback.displayName || "").trim();
  const declaredTemplateId = String(raw.templateId || raw.template || "").trim();
  const upstream = normalizeUpstream(applyTemplateUpstreamDefaults(raw.upstream, declaredTemplateId));
  const templateId = inferTemplateId(raw, upstream);
  return {
    schemaVersion: String(raw.schemaVersion || "v0.0.1:schema:definition-1"),
    kind: raw.kind || EXTERNAL_SERVICE_CONFIG_KIND,
    templateId,
    serviceId,
    serviceName: String(raw.serviceName || fallback.serviceName || serviceId).trim(),
    ...(displayName ? { displayName } : {}),
    mode,
    startupPolicy: normalizedStartupPolicy(raw.startupPolicy, mode),
    description: String(raw.description || raw.summary || fallback.summary || "").trim(),
    coreFeatureIds: uniqueStrings(raw.coreFeatureIds || DEFAULT_CORE_FEATURE_IDS),
    featureIds: uniqueStrings(raw.featureIds || raw.applicationFeatureIds || fallback.featureIds),
    requiredOperations: uniqueStrings(raw.requiredOperations || fallback.requiredOperations),
    includePaths: uniqueStrings(raw.includePaths || fallback.includePaths),
    scriptRoots: uniqueStrings(raw.scriptRoots),
    scripts,
    policyPreset: enumValue(raw.policyPreset, EXTERNAL_SERVICE_POLICY_PRESET_VALUES, EXTERNAL_SERVICE_POLICY_PRESET.PRODUCTION_DEFAULT),
    policies: asObject(raw.policies),
    tools: asArray(raw.tools),
    upstream,
    binding: normalizeBinding(raw.binding, upstream),
    healthCheck: {
      type: enumValue(
        healthCheck.type,
        EXTERNAL_SERVICE_HEALTH_CHECK_TYPE_VALUES,
        healthCheck.url || healthCheck.path || healthCheck.port
          ? EXTERNAL_SERVICE_HEALTH_CHECK_TYPE.HTTP
          : EXTERNAL_SERVICE_HEALTH_CHECK_TYPE.NONE
      ),
      url: String(healthCheck.url || "").trim(),
      host: String(healthCheck.host || "127.0.0.1").trim(),
      port: healthCheck.port === undefined ? null : Number(healthCheck.port),
      path: String(healthCheck.path || "/").trim(),
      timeoutMs: Number(healthCheck.timeoutMs || 60000),
      required: healthCheck.required === true
    },
    runtimeDependencies: asArray(raw.runtimeDependencies || raw.dependencies),
    docker: asObject(raw.docker),
    metadata: asObject(raw.metadata)
  };
}

function scriptPathRefs(config = {}) {
  return Object.values(config.scripts || {})
    .map((script) => script.path)
    .filter(Boolean);
}

export function externalServicePathRefs(config = {}) {
  return uniqueStrings([
    ...scriptPathRefs(config),
    ...asArray(config.scriptRoots)
  ]);
}

function effectiveTemplateId(config = {}) {
  if (config.templateId) {
    return String(config.templateId || "").trim();
  }
  return inferTemplateId(config, normalizeUpstream(config.upstream) || config.upstream);
}

function requiresServiceHubTemplate(config = {}) {
  const type = String(config.upstream?.type || "").trim();
  return [
    EXTERNAL_SERVICE_UPSTREAM_TYPE.MCP,
    EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTP,
    EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTPS,
    EXTERNAL_SERVICE_UPSTREAM_TYPE.RPC,
    EXTERNAL_SERVICE_UPSTREAM_TYPE.JSON_RPC,
    EXTERNAL_SERVICE_UPSTREAM_TYPE.SSE,
    EXTERNAL_SERVICE_UPSTREAM_TYPE.LLM
  ].includes(type);
}

function isServiceHubTemplateId(templateId = "") {
  return EXTERNAL_SERVICE_TEMPLATE_ID_VALUES.includes(String(templateId || "").trim());
}

function upstreamEndpointText(config = {}) {
  const upstream = asObject(config.upstream);
  return String(upstream.baseUrl || upstream.url || "").trim();
}

function validateExplicitEndpoint(errors, value = "", {
  label = "upstream.url",
  requiredMessage = "",
  scheme = ""
} = {}) {
  const endpoint = String(value || "").trim();
  if (!endpoint) {
    if (requiredMessage) {
      errors.push(requiredMessage);
    }
    return null;
  }
  try {
    const parsed = parseExplicitHttpUrl(endpoint, label);
    if (scheme && parsed.parsed.protocol !== `${scheme}:`) {
      errors.push(`${label} must use ${scheme}.`);
    }
    return parsed;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return null;
  }
}

function validateServiceHubEgressEndpoint(errors, config = {}, value = "", label = "upstream.url") {
  const endpoint = String(value || "").trim();
  if (!endpoint) {
    return;
  }
  try {
    assertExternalServiceEgressAllowed({
      url: endpoint,
      label,
      policyPreset: config.policyPreset,
      policies: config.policies
    });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}

function toolDisplayId(tool = {}, fallback = "unknown") {
  return String(
    tool?.name ||
    tool?.toolId ||
    tool?.id ||
    tool?.operationId ||
    tool?.operation_id ||
    tool?.method ||
    tool?.rpc?.method ||
    fallback
  ).trim();
}

function toolStableIdentity(tool = {}) {
  return String(
    tool?.name ||
    tool?.toolId ||
    tool?.id ||
    tool?.operationId ||
    tool?.operation_id ||
    ""
  ).trim();
}

function toolTransport(tool = {}) {
  return asObject(tool?.transport || tool?.http || tool?.request?.transport);
}

function validateHttpJsonTools(errors, config = {}, templateLabel = "External HTTP JSON") {
  const tools = asArray(config.tools);
  if (tools.length === 0) {
    errors.push(`${templateLabel} template requires at least one tools[] mapping.`);
    return;
  }
  tools.forEach((tool, index) => {
    const transport = toolTransport(tool);
    const displayId = toolDisplayId(tool, `tools[${index}]`);
    if (!toolStableIdentity(tool)) {
      errors.push(`${templateLabel} tool at index ${index} requires one of name, toolId, id, or operationId.`);
    }
    const method = String(transport.method || tool?.method || "").trim().toUpperCase();
    if (!method) {
      errors.push(`${templateLabel} tool ${displayId} requires transport.method.`);
    } else if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method)) {
      errors.push(`${templateLabel} tool ${displayId} has unsupported transport.method: ${method}.`);
    }
    const pathText = String(transport.path || tool?.path || tool?.urlPath || "").trim();
    if (!pathText) {
      errors.push(`${templateLabel} tool ${displayId} requires transport.path.`);
    }
  });
}

function validateJsonRpcTools(errors, config = {}) {
  const tools = asArray(config.tools);
  if (tools.length === 0) {
    errors.push("JSON-RPC template requires at least one tools[] method mapping.");
    return;
  }
  tools.forEach((tool, index) => {
    const rpc = asObject(tool?.rpc);
    const transport = toolTransport(tool);
    if (!toolStableIdentity(tool)) {
      errors.push(`JSON-RPC tool at index ${index} requires one of name, toolId, id, or operationId.`);
    }
    const method = String(rpc.method || tool?.method || transport.method || "").trim();
    if (!method) {
      errors.push(`JSON-RPC tool at index ${index} requires rpc.method or method.`);
    }
  });
}

function validateSseTools(errors, config = {}) {
  const tools = asArray(config.tools);
  if (tools.length === 0) {
    errors.push("SSE template requires at least one tools[] stream mapping.");
    return;
  }
  tools.forEach((tool, index) => {
    if (!toolStableIdentity(tool)) {
      errors.push(`SSE tool at index ${index} requires one of name, toolId, id, or operationId.`);
    }
    const transport = toolTransport(tool);
    const transportType = String(transport.type || tool?.type || "").trim();
    if (transportType && transportType !== "sse") {
      errors.push(`SSE tool ${toolDisplayId(tool, `tools[${index}]`)} transport.type must be sse when declared.`);
    }
  });
}

function validateHeaderMapDoesNotContainSecrets(errors, headers = {}, label = "headers") {
  for (const [key, value] of Object.entries(asObject(headers))) {
    if (isSensitiveHeaderName(key)) {
      errors.push(`ServiceHub ${label} must not declare literal sensitive header ${key}; use upstream.auth.secretRef.`);
      continue;
    }
    if (isLiteralCredentialHeaderValue(value)) {
      errors.push(`ServiceHub ${label} must not declare literal credential value for header ${key}; use upstream.auth.secretRef.`);
    }
  }
}

function validateServiceHubSecretRefs(errors, config = {}, templateId = "") {
  if (!isServiceHubTemplateId(templateId)) {
    return;
  }
  const upstream = asObject(config.upstream);
  const auth = asObject(upstream.auth, null);
  if (auth) {
    const authType = String(auth.type || "").trim();
    if (!authType) {
      errors.push("ServiceHub upstream auth must declare upstream.auth.type when auth is used.");
    }
    const secretRef = String(auth.secretRef || "").trim();
    if (!secretRef) {
      errors.push("ServiceHub upstream auth must use upstream.auth.secretRef; literal credentials are not allowed.");
    } else if (!secretRef.startsWith("secret://")) {
      errors.push("ServiceHub upstream auth secretRef must use a secret:// reference.");
    }
    for (const key of Object.keys(auth)) {
      if (key !== "type" && key !== "scheme" && key !== "secretRef" && key !== "headerName" && key !== "metadata") {
        errors.push(`ServiceHub upstream auth must not contain literal credential field ${key}; use secretRef.`);
      }
    }
  }
  validateHeaderMapDoesNotContainSecrets(errors, upstream.defaultHeaders, "upstream.defaultHeaders");
  asArray(config.tools).forEach((tool, index) => {
    const transport = toolTransport(tool);
    validateHeaderMapDoesNotContainSecrets(errors, transport.headers, `tools[${index}].transport.headers`);
    validateHeaderMapDoesNotContainSecrets(errors, tool?.request?.headers, `tools[${index}].request.headers`);
  });
}

export async function validateExternalServiceConfig({
  config,
  cwd = process.cwd(),
  requireKnownPaths = true
} = {}) {
  const errors = [];
  const warnings = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ok: false, errors: ["External service config must be a JSON object."], warnings };
  }
  if (config.kind !== EXTERNAL_SERVICE_CONFIG_KIND) {
    errors.push(`External service config kind must be ${EXTERNAL_SERVICE_CONFIG_KIND}.`);
  }
  if (!config.serviceId) {
    errors.push("External service config is missing serviceId.");
  }
  if (!config.serviceName && !config.serviceId) {
    errors.push("External service config is missing serviceName.");
  }
  const templateId = effectiveTemplateId(config);
  if (!templateId && requiresServiceHubTemplate(config)) {
    errors.push("External service config is missing templateId or an inferable upstream.type.");
  } else if (templateId && !EXTERNAL_SERVICE_TEMPLATE_ID_VALUES.includes(templateId)) {
    errors.push(`External service templateId is not supported: ${templateId}.`);
  }
  if (config.policyPreset && !EXTERNAL_SERVICE_POLICY_PRESET_VALUES.includes(config.policyPreset)) {
    errors.push(`External service policyPreset is not supported: ${config.policyPreset}.`);
  }
  for (const [id, script] of Object.entries(config.scripts || {})) {
    if (!script.path && !script.command?.executable) {
      errors.push(`External service script ${id} must declare path or command.executable.`);
    }
  }
  if (config.startupPolicy === "with-platform" && !config.scripts?.start) {
    errors.push("External service startupPolicy with-platform requires scripts.start.");
  }
  if (!config.upstream) {
    errors.push("External service config is missing upstream.");
  }
  if (config.upstream) {
    const upstreamTransport = String(config.upstream.transport || "").trim();
    if (config.upstream.type === EXTERNAL_SERVICE_UPSTREAM_TYPE.OPENAI) {
      errors.push("External upstream.type=openai is retired; use upstream.type=llm with modelProtocol=openai-compatible or openai-responses.");
    }
    if (
      config.binding?.outlet === EXTERNAL_SERVICE_BINDING_OUTLET.SERVICE_HUB &&
      (upstreamTransport === EXTERNAL_SERVICE_MCP_TRANSPORT.STDIO ||
        upstreamTransport === EXTERNAL_SERVICE_ACP_TRANSPORT.STDIO ||
        hasLocalLaunchDescriptor(config.upstream))
    ) {
      errors.push("ServiceHub external services must not expose local stdio or command-backed upstreams; use a controlled HTTP/HTTPS endpoint or the Agent Relay internal adapter instead.");
    }
    if (config.upstream.type === EXTERNAL_SERVICE_UPSTREAM_TYPE.MCP) {
      const transport = String(config.upstream.transport || "").trim();
      if (![EXTERNAL_SERVICE_MCP_TRANSPORT.STREAMABLE_HTTP, EXTERNAL_SERVICE_MCP_TRANSPORT.SSE].includes(transport)) {
        errors.push(`External MCP upstream transport must be streamable-http or sse; ${transport || "missing"} is not allowed for ServiceHub.`);
      }
      if (hasLocalLaunchDescriptor(config.upstream)) {
        errors.push("External MCP upstream must not declare command, args, cwd, or env; expose a controlled HTTP/HTTPS MCP endpoint instead.");
      }
      if (!config.upstream.url) {
        errors.push("External MCP upstream requires upstream.url.");
      } else {
        try {
          parseExplicitHttpUrl(config.upstream.url, "upstream.url");
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (templateId === EXTERNAL_SERVICE_TEMPLATE_ID.RAW_MCP_STREAMABLE_HTTP && transport !== EXTERNAL_SERVICE_MCP_TRANSPORT.STREAMABLE_HTTP) {
        errors.push("Template external-service.template.raw-mcp-streamable-http requires upstream.transport=streamable-http.");
      }
      if (templateId === EXTERNAL_SERVICE_TEMPLATE_ID.RAW_MCP_SSE && transport !== EXTERNAL_SERVICE_MCP_TRANSPORT.SSE) {
        errors.push("Template external-service.template.raw-mcp-sse requires upstream.transport=sse.");
      }
    } else if (config.upstream.type === EXTERNAL_SERVICE_UPSTREAM_TYPE.ACP) {
      const transport = String(config.upstream.transport || "").trim();
      if (!EXTERNAL_SERVICE_ACP_TRANSPORT_VALUES.includes(transport)) {
        errors.push(`External ACP upstream transport is not supported: ${transport}.`);
      }
      if (transport === EXTERNAL_SERVICE_ACP_TRANSPORT.STDIO) {
        errors.push("External ACP stdio upstreams are disabled; Pact does not expose local stdio interfaces. Use an authenticated HTTP/HTTPS Agent Relay endpoint instead.");
      } else {
        const upstreamUrl = String(config.upstream.url || "").trim();
        if (!upstreamUrl) {
          errors.push(`External ACP ${transport || "remote"} upstream requires upstream.url.`);
        } else if (isHttpUrlText(upstreamUrl)) {
          try {
            parseExplicitHttpUrl(upstreamUrl, "upstream.url");
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
        }
      }
    } else if (config.upstream.type === EXTERNAL_SERVICE_UPSTREAM_TYPE.CLOUD_DRIVE) {
      const providers = uniqueStrings([
        config.upstream.provider,
        ...asArray(config.upstream.providers)
      ]).filter(Boolean);
      for (const provider of providers) {
        if (!EXTERNAL_SERVICE_CLOUD_DRIVE_PROVIDER_VALUES.includes(provider)) {
          errors.push(`External cloud-drive upstream provider is not supported: ${provider}.`);
        }
      }
      if (providers.length === 0) {
        warnings.push("External cloud-drive upstream does not declare provider; Pact will treat it as a gateway aggregate.");
      }
      const mode = String(config.upstream.mode || "").trim();
      if (mode && !EXTERNAL_SERVICE_CLOUD_DRIVE_MODE_VALUES.includes(mode)) {
        errors.push(`External cloud-drive upstream mode is not supported: ${mode}.`);
      }
      const endpointUrl = String(config.upstream.endpointUrl || config.upstream.url || "").trim();
      if (mode === EXTERNAL_SERVICE_CLOUD_DRIVE_MODE.REMOTE_LIVE && !endpointUrl) {
        errors.push("External cloud-drive remote-live upstream requires endpointUrl or url.");
      }
      if (endpointUrl && isHttpUrlText(endpointUrl)) {
        try {
          parseExplicitHttpUrl(endpointUrl, "upstream.endpointUrl");
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (
        providers.some((provider) => provider !== EXTERNAL_SERVICE_CLOUD_DRIVE_PROVIDER.ICLOUD) &&
        mode !== EXTERNAL_SERVICE_CLOUD_DRIVE_MODE.LOCAL &&
        config.upstream.secretRef &&
        !String(config.upstream.secretRef).startsWith("secret://")
      ) {
        errors.push("External cloud-drive OAuth provider secret must use a secret:// secretRef.");
      }
    } else {
      const upstreamUrl = String(config.upstream.url || config.upstream.baseUrl || "").trim();
      if (upstreamUrl && (isHttpLikeUpstreamType(config.upstream.type) || isHttpUrlText(upstreamUrl))) {
        try {
          parseExplicitHttpUrl(upstreamUrl, "upstream.url");
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (
        config.upstream.type === EXTERNAL_SERVICE_UPSTREAM_TYPE.LLM &&
        config.upstream.modelProtocol &&
        !EXTERNAL_SERVICE_MODEL_PROTOCOL_VALUES.includes(config.upstream.modelProtocol)
      ) {
        warnings.push(`External LLM service modelProtocol is custom: ${config.upstream.modelProtocol}.`);
      }
      if (config.upstream.type === EXTERNAL_SERVICE_UPSTREAM_TYPE.OPENAPI) {
        if (!upstreamUrl) {
          errors.push("External OpenAPI upstream requires upstream.baseUrl or upstream.url.");
        }
        if (!config.upstream.spec && !config.upstream.specUrl && !config.upstream.specFile) {
          errors.push("External OpenAPI upstream requires upstream.spec, upstream.specUrl, or upstream.specFile.");
        }
      }
      if (config.upstream.type === EXTERNAL_SERVICE_UPSTREAM_TYPE.RPC || config.upstream.type === EXTERNAL_SERVICE_UPSTREAM_TYPE.JSON_RPC) {
        if (!upstreamUrl) {
          errors.push("External RPC upstream requires upstream.url or upstream.baseUrl.");
        }
        if (!asArray(config.tools).some((tool) => tool?.rpc || tool?.method || tool?.operationId)) {
          errors.push("External RPC upstream requires at least one tool with rpc.method or operationId.");
        }
        for (const tool of asArray(config.tools)) {
          const rpc = asObject(tool?.rpc);
          const endpointRef = String(rpc.endpointRef || rpc.endpoint || rpc.endpointId || "").trim();
          if (endpointRef && !rpcEndpointByRef(config, endpointRef)) {
            const operationId = String(tool?.operationId || tool?.rpc?.method || tool?.name || "unknown").trim();
            errors.push(`External RPC tool ${operationId} references unknown endpointRef: ${endpointRef}.`);
          }
          if (!hasExplicitRpcPath(config, tool)) {
            const operationId = String(tool?.operationId || tool?.rpc?.method || tool?.name || "unknown").trim();
            errors.push(`External RPC tool ${operationId} requires an explicit RPC endpoint path in tools[].rpc.url, tools[].rpc.path, tools[].rpc.endpointRef, upstream.url, upstream.path, or upstream.rpcPath.`);
          }
        }
      }
    }
  }
  if (config.upstream && templateId) {
    const type = config.upstream.type;
    const transport = String(config.upstream.transport || "").trim();
    if (
      isServiceHubTemplateId(templateId) &&
      config.binding?.outlet &&
      config.binding.outlet !== EXTERNAL_SERVICE_BINDING_OUTLET.SERVICE_HUB
    ) {
      errors.push("ServiceHub external service templates must bind to pact.serviceHub.");
    }
    validateServiceHubSecretRefs(errors, config, templateId);
    if (isServiceHubTemplateId(templateId)) {
      validateServiceHubEgressEndpoint(
        errors,
        config,
        upstreamEndpointText(config),
        templateId === EXTERNAL_SERVICE_TEMPLATE_ID.HTTP_JSON || templateId === EXTERNAL_SERVICE_TEMPLATE_ID.HTTPS_JSON
          ? "upstream.baseUrl"
          : "upstream.url"
      );
      if (config.upstream.specUrl) {
        validateServiceHubEgressEndpoint(errors, config, config.upstream.specUrl, "upstream.specUrl");
      }
    }
    if (
      templateId === EXTERNAL_SERVICE_TEMPLATE_ID.RAW_MCP_STREAMABLE_HTTP &&
      (type !== EXTERNAL_SERVICE_UPSTREAM_TYPE.MCP || transport !== EXTERNAL_SERVICE_MCP_TRANSPORT.STREAMABLE_HTTP)
    ) {
      errors.push("Template external-service.template.raw-mcp-streamable-http requires upstream.type=mcp and upstream.transport=streamable-http.");
    }
    if (
      templateId === EXTERNAL_SERVICE_TEMPLATE_ID.RAW_MCP_SSE &&
      (type !== EXTERNAL_SERVICE_UPSTREAM_TYPE.MCP || transport !== EXTERNAL_SERVICE_MCP_TRANSPORT.SSE)
    ) {
      errors.push("Template external-service.template.raw-mcp-sse requires upstream.type=mcp and upstream.transport=sse.");
    }
    if (templateId === EXTERNAL_SERVICE_TEMPLATE_ID.HTTP_JSON && type !== EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTP) {
      errors.push("Template external-service.template.http-json requires upstream.type=http.");
    }
    if (templateId === EXTERNAL_SERVICE_TEMPLATE_ID.HTTPS_JSON && type !== EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTPS) {
      errors.push("Template external-service.template.https-json requires upstream.type=https.");
    }
  if (templateId === EXTERNAL_SERVICE_TEMPLATE_ID.JSON_RPC && ![EXTERNAL_SERVICE_UPSTREAM_TYPE.JSON_RPC, EXTERNAL_SERVICE_UPSTREAM_TYPE.RPC].includes(type)) {
      errors.push("Template external-service.template.json-rpc requires upstream.type=json-rpc.");
    }
    if (templateId === EXTERNAL_SERVICE_TEMPLATE_ID.SSE && type !== EXTERNAL_SERVICE_UPSTREAM_TYPE.SSE) {
      errors.push("Template external-service.template.sse requires upstream.type=sse.");
    }
    if (templateId === EXTERNAL_SERVICE_TEMPLATE_ID.OPENAI_MODEL_GATEWAY && type !== EXTERNAL_SERVICE_UPSTREAM_TYPE.LLM) {
      errors.push("Template external-service.template.openai-model-gateway requires upstream.type=llm.");
    }
    if (templateId === EXTERNAL_SERVICE_TEMPLATE_ID.HTTP_JSON) {
      validateExplicitEndpoint(errors, upstreamEndpointText(config), {
        label: "upstream.baseUrl",
        requiredMessage: "HTTP JSON template requires upstream.baseUrl.",
        scheme: "http"
      });
      validateHttpJsonTools(errors, config, "HTTP JSON");
    }
    if (templateId === EXTERNAL_SERVICE_TEMPLATE_ID.HTTPS_JSON) {
      validateExplicitEndpoint(errors, upstreamEndpointText(config), {
        label: "upstream.baseUrl",
        requiredMessage: "HTTPS JSON template requires upstream.baseUrl.",
        scheme: "https"
      });
      validateHttpJsonTools(errors, config, "HTTPS JSON");
    }
    if (templateId === EXTERNAL_SERVICE_TEMPLATE_ID.JSON_RPC) {
      validateExplicitEndpoint(errors, upstreamEndpointText(config), {
        label: "upstream.url",
        requiredMessage: "JSON-RPC template requires upstream.url.",
      });
      validateJsonRpcTools(errors, config);
    }
    if (templateId === EXTERNAL_SERVICE_TEMPLATE_ID.SSE) {
      validateExplicitEndpoint(errors, upstreamEndpointText(config), {
        label: "upstream.url",
        requiredMessage: "SSE template requires upstream.url.",
      });
      validateSseTools(errors, config);
      warnings.push("Generic SSE registration is validated as a separate template; production event streaming still requires the ServiceHub Streaming And Backpressure verifier before promotion.");
    }
    if (templateId === EXTERNAL_SERVICE_TEMPLATE_ID.OPENAI_MODEL_GATEWAY) {
      validateExplicitEndpoint(errors, upstreamEndpointText(config), {
        label: "upstream.url",
        requiredMessage: "OpenAI-compatible model gateway template requires upstream.url.",
      });
    }
  }
  if (config.binding?.mode && !EXTERNAL_SERVICE_BINDING_MODE_VALUES.includes(config.binding.mode)) {
    errors.push(`External service binding mode is not supported: ${config.binding.mode}.`);
  }
  if (config.binding?.outlet && !EXTERNAL_SERVICE_BINDING_OUTLET_VALUES.includes(config.binding.outlet)) {
    errors.push(`External service binding outlet is not supported: ${config.binding.outlet}.`);
  }
  if (config.binding?.risk && !EXTERNAL_SERVICE_RISK_VALUES.includes(config.binding.risk)) {
    errors.push(`External service binding risk is not supported: ${config.binding.risk}.`);
  }

  const missingPaths = [];
  if (requireKnownPaths) {
    for (const pathRef of externalServicePathRefs(config)) {
      const candidate = path.isAbsolute(pathRef) ? pathRef : path.resolve(cwd, pathRef);
      try {
        await fs.stat(candidate);
      } catch {
        missingPaths.push(pathRef);
      }
    }
  }
  for (const pathRef of missingPaths) {
    errors.push(`External service references missing path ${pathRef}.`);
  }
  if (config.healthCheck?.type && !EXTERNAL_SERVICE_HEALTH_CHECK_TYPE_VALUES.includes(config.healthCheck.type)) {
    errors.push(`External service health check type is not supported: ${config.healthCheck.type}.`);
  }
  if (config.healthCheck?.type === EXTERNAL_SERVICE_HEALTH_CHECK_TYPE.HTTP && !config.healthCheck.url && !config.healthCheck.port) {
    warnings.push("External service HTTP health check has no url or port.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    missingPaths
  };
}

export async function loadExternalServiceConfig(filePath, { cwd = process.cwd() } = {}) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  const raw = JSON.parse(await fs.readFile(absolutePath, "utf8"));
  return {
    filePath: absolutePath,
    config: normalizeExternalServiceConfig(raw, {
      serviceId: raw.serviceId || path.basename(filePath).replace(/\.[^.]+$/, "")
    })
  };
}

export function compositionPresetFromExternalServiceConfig(config, {
  filePath = "",
  outputRoot = ""
} = {}) {
  const serviceId = config.serviceId;
  const applicationFeatureIds = uniqueStrings(config.featureIds);
  const scriptPaths = scriptPathRefs(config);
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    kind: "pact.composition.preset",
    presetId: serviceId,
    displayName: config.displayName || serviceId,
    status: "active",
    compositionClass: "deployment-dependency-package",
    deploymentTarget: {
      applicationId: serviceId,
      serviceName: config.serviceName,
      boundary: "external-service-compatibility",
      outputBundleId: `pact-${serviceId}`,
      outputRoot: outputRoot || `build/composition-packages/${serviceId}`
    },
    intent: {
      summary: config.description || `External service composition for ${serviceId}.`,
      serviceKind: "external-service",
      provider: config.serviceName,
      sourceConfig: filePath
    },
    coreDependencyPackage: {
      policy: "include-platform-core-required-by-external-service",
      featureIds: uniqueStrings(config.coreFeatureIds),
      preserveContracts: [
        "v0.0.1:risk-control:permissions-1",
        "v0.0.1:operation:operation-dispatcher-1",
        "v0.0.1:storage:core-1",
        "v0.0.1:tool:module-management-1",
        "v0.0.1:platform:devops-1"
      ]
    },
    applicationDependencyPackage: {
      policy: "include-external-service-declared-dependencies",
      featureIds: applicationFeatureIds,
      scripts: scriptPaths,
      serviceRoots: uniqueStrings(config.scriptRoots),
      requiredOperations: uniqueStrings(config.requiredOperations)
    },
    externalService: config,
    startupComposition: {
      enabled: true,
      bindProviders: [],
      healthGates: config.healthCheck?.type === "http" ? [`external-service:${serviceId}:health`] : [],
      fallbackPolicy: config.mode === "connected" ? "external-endpoint-required" : "configured-script-or-endpoint-required"
    }
  };
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyPath(source, destination) {
  await fs.cp(source, destination, {
    recursive: true,
    force: true,
    errorOnExist: false,
    filter: (entry) => path.basename(entry) !== ".DS_Store" && path.basename(entry) !== "node_modules"
  });
}

function packageScriptPath({ scriptPath, sourceRoot, cwd, index }) {
  if (!scriptPath) {
    return scriptPath;
  }
  const sourceCandidate = path.isAbsolute(scriptPath) ? scriptPath : path.resolve(cwd, scriptPath);
  const sourceRelativeCandidate = path.join(sourceRoot, scriptPath);
  return {
    sourceRelativeCandidate,
    packagedPath: path.posix.join("composition", "external-service-scripts", `${index}-${path.basename(scriptPath)}`),
    sourcePath: sourceCandidate,
    originalPath: scriptPath
  };
}

export async function writeExternalServiceArtifacts({
  config,
  sourceRoot,
  outputRoot,
  cwd = process.cwd()
} = {}) {
  if (!config) {
    return null;
  }
  const sourceConfig = structuredClone(config);
  const copiedPaths = [];
  let scriptIndex = 0;
  for (const [id, script] of Object.entries(sourceConfig.scripts || {})) {
    if (!script.path) {
      continue;
    }
    scriptIndex += 1;
    const packaged = packageScriptPath({ scriptPath: script.path, sourceRoot, cwd, index: scriptIndex });
    if (
      !path.isAbsolute(packaged.originalPath) &&
      packaged.sourceRelativeCandidate.startsWith(sourceRoot) &&
      await pathExists(packaged.sourceRelativeCandidate)
    ) {
      script.path = packaged.originalPath;
      continue;
    }
    if (await pathExists(packaged.sourcePath)) {
      await fs.mkdir(path.join(sourceRoot, "composition", "external-service-scripts"), { recursive: true });
      await copyPath(packaged.sourcePath, path.join(sourceRoot, packaged.packagedPath));
      copiedPaths.push({ id, sourcePath: packaged.sourcePath, packagedPath: packaged.packagedPath });
    }
    script.path = packaged.packagedPath;
  }
  let rootIndex = 0;
  const copiedRoots = [];
  sourceConfig.scriptRoots = [];
  for (const rootPath of config.scriptRoots || []) {
    rootIndex += 1;
    const sourcePath = path.isAbsolute(rootPath) ? rootPath : path.resolve(cwd, rootPath);
    const packagedPath = path.posix.join("composition", "external-service-scripts", `root-${rootIndex}-${path.basename(rootPath)}`);
    if (await pathExists(sourcePath)) {
      await copyPath(sourcePath, path.join(sourceRoot, packagedPath));
      copiedRoots.push({ sourcePath, packagedPath });
      sourceConfig.scriptRoots.push(packagedPath);
    }
  }

  await fs.mkdir(path.join(sourceRoot, "composition"), { recursive: true });
  await fs.writeFile(
    path.join(sourceRoot, "composition", "external-service.config.json"),
    `${JSON.stringify(sourceConfig, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(sourceRoot, "composition", "EXTERNAL_SERVICE.md"),
    [
      `# ${sourceConfig.displayName || sourceConfig.serviceId}`,
      "",
      `Service: \`${sourceConfig.serviceName}\``,
      `Mode: \`${sourceConfig.mode}\``,
      `Startup policy: \`${sourceConfig.startupPolicy}\``,
      "",
      "## Commands",
      "",
      "```bash",
      "npm run composition:external:verify",
      "npm run composition:external:prepare",
      "npm run composition:external:start",
      "npm run composition:external:health",
      "npm run composition:external:stop",
      "```",
      ""
    ].join("\n"),
    "utf8"
  );
  if (outputRoot) {
    await fs.mkdir(outputRoot, { recursive: true });
    await fs.writeFile(
      path.join(outputRoot, "external-service.config.json"),
      `${JSON.stringify(sourceConfig, null, 2)}\n`,
      "utf8"
    );
  }
  return {
    ok: true,
    serviceId: sourceConfig.serviceId,
    sourceConfigPath: path.join(sourceRoot, "composition", "external-service.config.json"),
    copiedPaths,
    copiedRoots
  };
}
