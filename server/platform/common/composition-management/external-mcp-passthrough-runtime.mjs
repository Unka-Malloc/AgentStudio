import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { ServerConfig } from "../config/ServerConfig.mjs";

export const EXTERNAL_MCP_CACHE_KIND = "pact.external-mcp.tool-cache";
export const EXTERNAL_MCP_VIRTUAL_OPERATION_ASPECT = "external-mcp-passthrough";
export const EXTERNAL_MCP_PROTOCOL_VERSION = "pact.external-mcp-passthrough.v1";
export const EXTERNAL_HTTP_COMPILE_VIRTUAL_OPERATION_ASPECT = "external-http-compile";
export const EXTERNAL_HTTP_COMPILE_PROTOCOL_VERSION = "pact.external-http-compile.v1";
export const EXTERNAL_RPC_COMPILE_VIRTUAL_OPERATION_ASPECT = "external-rpc-compile";
export const EXTERNAL_RPC_COMPILE_PROTOCOL_VERSION = "pact.external-rpc-compile.v1";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_TIMEOUT_MS = 30_000;
const HTTP_COMPILE_UPSTREAM_TYPES = new Set(["http", "https", "openapi", "rpc"]);
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function nowIso() {
  return new Date().toISOString();
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function registryRoot(userDataPath = "") {
  return path.resolve(userDataPath || ServerConfig.getDataDir(), "external-services");
}

export function externalMcpToolCachePath(userDataPath = "") {
  return path.join(registryRoot(userDataPath), "mcp-tool-cache.json");
}

function safeSegment(value = "") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "tool";
}

function stableJson(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function explicitPortFromUrlText(value = "") {
  const text = String(value || "").trim();
  const match = text.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]+)/);
  if (!match) {
    return "";
  }
  const authority = match[1];
  const ipv6 = authority.match(/^\[[^\]]+\]:(\d+)$/);
  if (ipv6) {
    return ipv6[1];
  }
  const hostPort = authority.match(/^[^:]+:(\d+)$/);
  return hostPort ? hostPort[1] : "";
}

export function parseExplicitHttpUrl(value, label = "url") {
  const text = String(value || "").trim();
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${label} must be a valid http(s) URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must use http or https.`);
  }
  const explicitPort = explicitPortFromUrlText(text);
  if (!explicitPort) {
    throw new Error(`${label} must include an explicit port, for example http://127.0.0.1:8787/mcp.`);
  }
  const port = Number(explicitPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} explicit port must be between 1 and 65535.`);
  }
  return {
    url: text,
    parsed,
    explicitPort
  };
}

export function isExternalMcpPassthroughConfig(config = {}) {
  return config?.upstream?.type === "mcp" && config?.binding?.mode === "passthrough";
}

export function isExternalHttpCompileConfig(config = {}) {
  const upstreamType = String(config?.upstream?.type || "").trim();
  const hasOpenApiSpec = Boolean(config?.upstream?.spec || config?.upstream?.specUrl || config?.upstream?.specFile);
  return config?.binding?.mode === "compile" &&
    HTTP_COMPILE_UPSTREAM_TYPES.has(upstreamType) &&
    (asArray(config?.tools).length > 0 || (upstreamType === "openapi" && hasOpenApiSpec));
}

function normalizeMcpTool(raw = {}) {
  const name = String(raw.name || "").trim();
  if (!name) {
    return null;
  }
  const inputSchema = asObject(raw.inputSchema || raw.input_schema || raw.schema, { type: "object" });
  return {
    name,
    title: String(raw.title || raw.label || name).trim(),
    description: String(raw.description || "").trim(),
    inputSchema: Object.keys(inputSchema).length ? inputSchema : { type: "object" },
    annotations: asObject(raw.annotations),
    raw
  };
}

function normalizeInputSchema(value) {
  const inputSchema = asObject(value, null);
  return inputSchema && Object.keys(inputSchema).length ? inputSchema : { type: "object" };
}

function normalizeHttpTool(raw = {}, config = {}) {
  if (raw?.rpc || config?.upstream?.type === "rpc") {
    return normalizeRpcTool(raw, config);
  }
  const transport = asObject(raw.transport || raw.http || raw.request?.transport);
  const operationId = String(raw.operationId || raw.operation_id || raw.name || raw.toolId || raw.id || "").trim();
  const name = String(raw.name || operationId || raw.toolId || raw.id || "").trim();
  if (!name) {
    return null;
  }
  const method = String(transport.method || raw.method || "POST").trim().toUpperCase();
  const pathText = String(transport.path || raw.path || raw.urlPath || "").trim();
  if (!HTTP_METHODS.has(method) || !pathText) {
    return null;
  }
  const request = asObject(raw.request);
  const response = asObject(raw.response);
  const binding = asObject(config.binding);
  const risk = String(raw.risk || binding.risk || "read_only").trim();
  return {
    name,
    title: String(raw.title || raw.label || name).trim(),
    description: String(raw.description || "").trim(),
    inputSchema: normalizeInputSchema(raw.inputSchema || raw.input_schema || raw.schema),
    annotations: asObject(raw.annotations),
    requiredScopes: uniqueStrings(raw.requiredScopes || raw.scopes || binding.requiredScopes || ["knowledge:read"]),
    risk,
    readOnly: raw.readOnly === undefined ? risk === "read_only" : raw.readOnly !== false,
    transport: {
      type: "http",
      method,
      path: pathText,
      headers: asObject(transport.headers)
    },
    request: {
      query: request.query === undefined ? null : request.query,
      headers: asObject(request.headers),
      body: request.body === undefined ? request.bodyTemplate : request.body
    },
    response: {
      resultPath: String(response.resultPath || response.result_path || "").trim()
    },
    raw
  };
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

function urlHasPath(urlText = "") {
  try {
    const parsed = new URL(urlText);
    return Boolean(parsed.pathname && parsed.pathname !== "/");
  } catch {
    return false;
  }
}

function resolveRpcEndpoint(config = {}, rpc = {}) {
  const upstream = asObject(config.upstream);
  const endpointRef = String(rpc.endpointRef || rpc.endpoint || rpc.endpointId || "").trim();
  const endpoint = rpcEndpointByRef(config, endpointRef);
  if (endpointRef && !endpoint) {
    throw new Error(`External RPC endpointRef is not declared: ${endpointRef}`);
  }
  const url = String(rpc.url || endpoint?.url || endpoint?.baseUrl || upstream.url || upstream.baseUrl || "").trim();
  const pathText = String(rpc.path || endpoint?.path || endpoint?.rpcPath || upstream.path || upstream.rpcPath || "").trim();
  if (pathText) {
    return {
      endpointRef,
      protocol: String(rpc.protocol || endpoint?.protocol || upstream.protocol || "json-rpc-2.0").trim(),
      url,
      path: pathText
    };
  }
  if (urlHasPath(url)) {
    return {
      endpointRef,
      protocol: String(rpc.protocol || endpoint?.protocol || upstream.protocol || "json-rpc-2.0").trim(),
      url,
      path: ""
    };
  }
  throw new Error("External RPC tools require an explicit endpoint path in tools[].rpc.url, tools[].rpc.path, tools[].rpc.endpointRef, upstream.url, upstream.path, or upstream.rpcPath.");
}

function normalizeRpcTool(raw = {}, config = {}) {
  const rpc = asObject(raw.rpc);
  const endpoint = resolveRpcEndpoint(config, rpc);
  const operationId = String(raw.operationId || raw.operation_id || raw.name || raw.toolId || raw.id || rpc.method || "").trim();
  const methodName = String(rpc.method || raw.method || operationId).trim();
  const name = String(raw.name || operationId || methodName || "").trim();
  if (!name || !methodName) {
    return null;
  }
  const binding = asObject(config.binding);
  const risk = String(raw.risk || binding.risk || "read_only").trim();
  const protocol = endpoint.protocol;
  return {
    name,
    title: String(raw.title || raw.label || name).trim(),
    description: String(raw.description || "").trim(),
    inputSchema: normalizeInputSchema(raw.inputSchema || raw.input_schema || raw.schema),
    annotations: asObject(raw.annotations),
    requiredScopes: uniqueStrings(raw.requiredScopes || raw.scopes || binding.requiredScopes || ["knowledge:read"]),
    risk,
    readOnly: raw.readOnly === undefined ? risk === "read_only" : raw.readOnly !== false,
    transport: {
      type: "http",
      method: "POST",
      url: endpoint.url,
      path: endpoint.path,
      endpointRef: endpoint.endpointRef,
      headers: asObject(rpc.headers || raw.transport?.headers)
    },
    request: {
      query: null,
      headers: asObject(rpc.headers),
      body: null
    },
    response: {
      resultPath: String(rpc.resultPath || rpc.result_path || raw.response?.resultPath || "result").trim()
    },
    rpc: {
      protocol,
      method: methodName,
      endpointRef: endpoint.endpointRef,
      params: rpc.params === undefined ? "$input" : rpc.params,
      id: rpc.id === undefined ? "$request.id" : rpc.id,
      resultPath: String(rpc.resultPath || rpc.result_path || raw.response?.resultPath || "result").trim()
    },
    raw
  };
}

function pickJsonContent(content = {}) {
  const entries = Object.entries(asObject(content));
  return entries.find(([type]) => String(type).toLowerCase().includes("application/json"))?.[1] ||
    entries.find(([type]) => String(type).toLowerCase().includes("json"))?.[1] ||
    entries[0]?.[1] ||
    null;
}

function schemaFromOpenApiOperation(operation = {}) {
  const properties = {};
  const required = new Set();
  for (const parameter of asArray(operation.parameters)) {
    const name = String(parameter?.name || "").trim();
    if (!name) {
      continue;
    }
    properties[name] = asObject(parameter.schema, { type: "string" });
    if (parameter.required === true || parameter.in === "path") {
      required.add(name);
    }
  }
  const requestBody = asObject(operation.requestBody);
  const bodyContent = pickJsonContent(requestBody.content);
  const bodySchema = asObject(bodyContent?.schema, null);
  if (bodySchema?.type === "object" || bodySchema?.properties) {
    for (const [key, value] of Object.entries(asObject(bodySchema.properties))) {
      if (!properties[key]) {
        properties[key] = value;
      }
    }
    for (const key of asArray(bodySchema.required)) {
      required.add(String(key));
    }
  } else if (bodySchema) {
    properties.body = bodySchema;
    if (requestBody.required === true) {
      required.add("body");
    }
  }
  return {
    type: "object",
    ...(Object.keys(properties).length ? { properties } : {}),
    ...(required.size ? { required: [...required] } : {})
  };
}

function normalizeOpenApiPathParameters(pathParameters = [], operationParameters = []) {
  const byKey = new Map();
  for (const parameter of [...asArray(pathParameters), ...asArray(operationParameters)]) {
    const name = String(parameter?.name || "").trim();
    const location = String(parameter?.in || "").trim();
    if (!name || !location) {
      continue;
    }
    byKey.set(`${location}:${name}`, {
      name,
      in: location,
      required: parameter.required === true || location === "path",
      schema: asObject(parameter.schema, { type: "string" })
    });
  }
  return [...byKey.values()];
}

function normalizeOpenApiTool({ routePath, method, operation, pathParameters, config }) {
  const operationId = String(operation.operationId || `${method}_${routePath}`).trim();
  const name = safeSegment(operationId) || safeSegment(`${method}_${routePath}`);
  const parameters = normalizeOpenApiPathParameters(pathParameters, operation.parameters);
  const hasRequestBody = Boolean(operation.requestBody);
  const risk = String(config.binding?.risk || "read_only").trim();
  return {
    name,
    title: String(operation.summary || operationId || name).trim(),
    description: String(operation.description || operation.summary || "").trim(),
    inputSchema: schemaFromOpenApiOperation({
      ...operation,
      parameters
    }),
    annotations: {},
    requiredScopes: uniqueStrings(config.binding?.requiredScopes || ["knowledge:read"]),
    risk,
    readOnly: risk === "read_only",
    transport: {
      type: "http",
      method,
      path: routePath,
      headers: {}
    },
    request: {
      query: null,
      headers: {},
      body: null
    },
    response: {
      resultPath: ""
    },
    openapi: {
      operationId,
      parameters,
      hasRequestBody
    },
    raw: operation
  };
}

async function loadOpenApiSpec(config) {
  const upstream = asObject(config.upstream);
  if (upstream.spec && typeof upstream.spec === "object" && !Array.isArray(upstream.spec)) {
    return upstream.spec;
  }
  if (upstream.specUrl) {
    const { url } = parseExplicitHttpUrl(upstream.specUrl, "upstream.specUrl");
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`External OpenAPI spec fetch failed with HTTP ${response.status}.`);
    }
    return response.json();
  }
  if (upstream.specFile) {
    const specPath = path.isAbsolute(upstream.specFile)
      ? upstream.specFile
      : path.resolve(process.cwd(), upstream.specFile);
    return JSON.parse(await fsp.readFile(specPath, "utf8"));
  }
  return null;
}

async function compileOpenApiTools(config) {
  const spec = await loadOpenApiSpec(config);
  if (!spec) {
    throw new Error("External OpenAPI compile requires upstream.spec, upstream.specUrl, or upstream.specFile.");
  }
  const tools = [];
  for (const [routePath, pathItem] of Object.entries(asObject(spec.paths))) {
    const pathParameters = asArray(pathItem?.parameters);
    for (const [methodKey, operation] of Object.entries(asObject(pathItem))) {
      const method = String(methodKey || "").trim().toUpperCase();
      if (!HTTP_METHODS.has(method) || method === "HEAD" || method === "OPTIONS") {
        continue;
      }
      const tool = normalizeOpenApiTool({
        routePath,
        method,
        operation: asObject(operation),
        pathParameters,
        config
      });
      if (tool?.name) {
        tools.push(tool);
      }
    }
  }
  return tools;
}

async function compileExternalHttpTools(config) {
  if (config?.upstream?.type === "openapi") {
    return compileOpenApiTools(config);
  }
  return asArray(config?.tools)
    .map((tool) => normalizeHttpTool(tool, config))
    .filter(Boolean);
}

function externalHttpBaseUrl(source = {}) {
  const upstream = asObject(source.upstream || source);
  return String(upstream.baseUrl || upstream.url || "").trim();
}

function discoveryProtocolVersionForConfig(config = {}) {
  return config?.upstream?.type === "rpc"
    ? EXTERNAL_RPC_COMPILE_PROTOCOL_VERSION
    : EXTERNAL_HTTP_COMPILE_PROTOCOL_VERSION;
}

export async function discoverExternalHttpTools(config, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!isExternalHttpCompileConfig(config)) {
    return {
      ok: false,
      serviceId: config?.serviceId || "",
      tools: [],
      error: "Config is not an HTTP compile external service."
    };
  }
  const baseUrl = externalHttpBaseUrl(config);
  parseExplicitHttpUrl(baseUrl, "upstream.url");
  const tools = await compileExternalHttpTools(config, { timeoutMs });
  if (tools.length === 0) {
    throw new Error("External HTTP compile config did not produce any tools.");
  }
  return {
    ok: true,
    protocolVersion: discoveryProtocolVersionForConfig(config),
    serviceId: config.serviceId,
    serviceName: config.serviceName || config.serviceId,
    displayName: config.displayName || config.serviceId,
    upstream: {
      type: config.upstream.type,
      transport: "http",
      url: baseUrl,
      baseUrl
    },
    binding: {
      mode: config.binding.mode,
      outlet: config.binding.outlet || "pact.skillHub",
      requiredScopes: uniqueStrings(config.binding.requiredScopes || ["knowledge:read"]),
      risk: String(config.binding.risk || "read_only").trim()
    },
    tools,
    toolCount: tools.length,
    discoveredAt: nowIso(),
    fingerprint: fingerprint({
      serviceId: config.serviceId,
      upstream: config.upstream,
      binding: config.binding,
      tools: tools.map((tool) => ({
        name: tool.name,
        transport: tool.transport,
        inputSchema: tool.inputSchema,
        request: tool.request,
        response: tool.response,
        openapi: tool.openapi,
        rpc: tool.rpc
      }))
    })
  };
}

function readCacheFileSync(userDataPath = "") {
  try {
    const filePath = externalMcpToolCachePath(userDataPath);
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      schemaVersion: Number(raw.schemaVersion || 1),
      kind: raw.kind || EXTERNAL_MCP_CACHE_KIND,
      updatedAt: String(raw.updatedAt || "").trim(),
      services: asObject(raw.services)
    };
  } catch {
    return {
      schemaVersion: 1,
      kind: EXTERNAL_MCP_CACHE_KIND,
      updatedAt: "",
      services: {}
    };
  }
}

async function writeCacheFile(userDataPath = "", cache) {
  const filePath = externalMcpToolCachePath(userDataPath);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  return filePath;
}

function jsonRpcMessage(method, params = {}, id = null) {
  const message = {
    jsonrpc: "2.0",
    method
  };
  if (id !== null && id !== undefined) {
    message.id = id;
  }
  if (params !== undefined) {
    message.params = params;
  }
  return message;
}

function parseSseJsonPayload(text = "") {
  const events = [];
  let current = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) {
      if (current.length) {
        events.push(current.join("\n"));
        current = [];
      }
      continue;
    }
    if (line.startsWith("data:")) {
      current.push(line.slice(5).trimStart());
    }
  }
  if (current.length) {
    events.push(current.join("\n"));
  }
  for (const event of events) {
    try {
      const parsed = JSON.parse(event);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Ignore non-JSON SSE events.
    }
  }
  return null;
}

async function parseJsonRpcHttpResponse(response) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }
  if (contentType.includes("text/event-stream")) {
    return parseSseJsonPayload(text);
  }
  return JSON.parse(text);
}

async function postJsonRpc({ url, message, sessionId = "", timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs || DEFAULT_TIMEOUT_MS)));
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {})
      },
      body: JSON.stringify(message),
      signal: controller.signal
    });
    const nextSessionId = response.headers.get("mcp-session-id") || sessionId || "";
    const body = await parseJsonRpcHttpResponse(response);
    if (!response.ok) {
      const error = new Error(`External MCP HTTP ${response.status} for ${message.method}.`);
      error.statusCode = response.status;
      error.payload = body;
      throw error;
    }
    if (body?.error) {
      const error = new Error(body.error.message || `External MCP JSON-RPC error for ${message.method}.`);
      error.code = body.error.code;
      error.payload = body.error;
      throw error;
    }
    return {
      sessionId: nextSessionId,
      body,
      result: body?.result
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function initializeExternalMcpSession({ config, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const upstream = config.upstream || {};
  const { url } = parseExplicitHttpUrl(upstream.url, "upstream.url");
  const initialized = await postJsonRpc({
    url,
    timeoutMs,
    message: jsonRpcMessage("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "pact-external-mcp-passthrough",
        version: "0.0.1"
      }
    }, "pact-init")
  });
  if (initialized.sessionId) {
    await postJsonRpc({
      url,
      sessionId: initialized.sessionId,
      timeoutMs,
      message: jsonRpcMessage("notifications/initialized", {}, null)
    }).catch(() => null);
  }
  return {
    url,
    sessionId: initialized.sessionId,
    initializeResult: initialized.result || {}
  };
}

export async function discoverExternalMcpTools(config, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!isExternalMcpPassthroughConfig(config)) {
    return {
      ok: false,
      serviceId: config?.serviceId || "",
      tools: [],
      error: "Config is not an MCP passthrough external service."
    };
  }
  const session = await initializeExternalMcpSession({ config, timeoutMs });
  const listed = await postJsonRpc({
    url: session.url,
    sessionId: session.sessionId,
    timeoutMs,
    message: jsonRpcMessage("tools/list", {}, "pact-tools-list")
  });
  const tools = asArray(listed.result?.tools)
    .map(normalizeMcpTool)
    .filter(Boolean);
  return {
    ok: true,
    protocolVersion: EXTERNAL_MCP_PROTOCOL_VERSION,
    serviceId: config.serviceId,
    serviceName: config.serviceName || config.serviceId,
    displayName: config.displayName || config.serviceId,
    upstream: {
      type: "mcp",
      transport: config.upstream.transport,
      url: session.url
    },
    binding: {
      mode: config.binding.mode,
      outlet: config.binding.outlet || "pact.skillHub"
    },
    initializeResult: session.initializeResult,
    tools,
    toolCount: tools.length,
    discoveredAt: nowIso(),
    fingerprint: fingerprint({
      serviceId: config.serviceId,
      upstream: config.upstream,
      binding: config.binding,
      tools: tools.map((tool) => ({
        name: tool.name,
        inputSchema: tool.inputSchema
      }))
    })
  };
}

export async function refreshExternalMcpToolCache({
  userDataPath = "",
  config,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  discovery: providedDiscovery = null
} = {}) {
  if (!isExternalMcpPassthroughConfig(config) && !isExternalHttpCompileConfig(config)) {
    return {
      ok: true,
      skipped: true,
      reason: "not_external_tool_service"
    };
  }
  const discovery = providedDiscovery ||
    (isExternalMcpPassthroughConfig(config)
      ? await discoverExternalMcpTools(config, { timeoutMs })
      : await discoverExternalHttpTools(config, { timeoutMs }));
  const cache = readCacheFileSync(userDataPath);
  const nextCache = {
    schemaVersion: 1,
    kind: EXTERNAL_MCP_CACHE_KIND,
    updatedAt: nowIso(),
    services: {
      ...cache.services,
      [config.serviceId]: {
        serviceId: config.serviceId,
        serviceName: config.serviceName || config.serviceId,
        displayName: config.displayName || config.serviceId,
        upstream: discovery.upstream,
        binding: discovery.binding,
        tools: discovery.tools,
        toolCount: discovery.toolCount,
        discoveredAt: discovery.discoveredAt,
        fingerprint: discovery.fingerprint
      }
    }
  };
  const cachePath = await writeCacheFile(userDataPath, nextCache);
  return {
    ok: true,
    cachePath,
    serviceId: config.serviceId,
    toolCount: discovery.toolCount,
    tools: discovery.tools.map((tool) => tool.name),
    discoveredAt: discovery.discoveredAt
  };
}

function virtualOperationFromTool(service, tool) {
  const serviceSegment = safeSegment(service.serviceId);
  const toolSegment = safeSegment(tool.name);
  const isMcp = service?.upstream?.type === "mcp" && service?.binding?.mode === "passthrough";
  const isRpc = service?.upstream?.type === "rpc" || Boolean(tool.rpc);
  const operationPrefix = isMcp ? "external.mcp" : isRpc ? "external.rpc" : "external.http";
  const toolPrefix = isMcp ? "pact.externalMcp" : isRpc ? "pact.externalRpc" : "pact.externalHttp";
  const operationId = `${operationPrefix}.${serviceSegment}.${toolSegment}`;
  const toolId = `${toolPrefix}.${serviceSegment}.${toolSegment}`;
  const requiredScopes = uniqueStrings(tool.requiredScopes || service.binding?.requiredScopes || ["knowledge:read"]);
  const risk = String(tool.risk || service.binding?.risk || "read_only");
  return {
    id: operationId,
    toolId,
    feature: "external",
    featureId: isMcp ? "external-mcp" : isRpc ? "external-rpc" : "external-http",
    label: `${service.displayName || service.serviceId}: ${tool.title || tool.name}`,
    description: tool.description || (
      isMcp
        ? `Passthrough MCP tool ${tool.name} from external service ${service.serviceId}.`
        : isRpc
          ? `Compiled RPC tool ${tool.name} from external service ${service.serviceId}.`
          : `Compiled HTTP tool ${tool.name} from external service ${service.serviceId}.`
    ),
    target: {
      controller: isMcp ? "externalMcp" : isRpc ? "externalRpc" : "externalHttp",
      method: "execute"
    },
    http: {
      method: "POST",
      path: isMcp
        ? `/api/external/mcp/${encodeURIComponent(service.serviceId)}/tools/${encodeURIComponent(tool.name)}`
        : isRpc
          ? `/api/external/rpc/${encodeURIComponent(service.serviceId)}/tools/${encodeURIComponent(tool.name)}`
          : `/api/external/http/${encodeURIComponent(service.serviceId)}/tools/${encodeURIComponent(tool.name)}`
    },
    rpc: {
      method: operationId,
      body: "params"
    },
    requiredScopes,
    readOnly: tool.readOnly === undefined ? risk === "read_only" : tool.readOnly !== false,
    concurrencySafe: risk === "read_only",
    safety: {
      risk
    },
    inputSchema: tool.inputSchema || { type: "object" },
    aspects: [
      isMcp
        ? EXTERNAL_MCP_VIRTUAL_OPERATION_ASPECT
        : isRpc
          ? EXTERNAL_RPC_COMPILE_VIRTUAL_OPERATION_ASPECT
          : EXTERNAL_HTTP_COMPILE_VIRTUAL_OPERATION_ASPECT,
      "external-service",
      "skill-hub"
    ],
    externalMcp: {
      serviceId: service.serviceId,
      upstreamToolName: tool.name,
      upstream: service.upstream,
      binding: service.binding || {}
    },
    audit: {
      enabled: true,
      recordInput: true,
      recordOutput: false
    }
  };
}

function isCachedExternalToolService(service = {}) {
  if (service?.upstream?.type === "mcp" && service?.binding?.mode === "passthrough") {
    return true;
  }
  return service?.binding?.mode === "compile" && HTTP_COMPILE_UPSTREAM_TYPES.has(String(service?.upstream?.type || ""));
}

export function listExternalMcpVirtualOperationsSync({ userDataPath = "" } = {}) {
  const cache = readCacheFileSync(userDataPath);
  const operations = [];
  for (const service of Object.values(cache.services || {})) {
    if (!service?.serviceId || !isCachedExternalToolService(service)) {
      continue;
    }
    for (const tool of asArray(service.tools)) {
      if (!tool?.name) {
        continue;
      }
      operations.push(virtualOperationFromTool(service, tool));
    }
  }
  return operations.sort((left, right) => left.id.localeCompare(right.id));
}

export function describeExternalMcpToolCacheSync({ userDataPath = "" } = {}) {
  const cache = readCacheFileSync(userDataPath);
  const services = {};
  for (const service of Object.values(cache.services || {})) {
    if (!service?.serviceId) {
      continue;
    }
    services[service.serviceId] = {
      serviceId: service.serviceId,
      upstream: service.upstream || null,
      binding: service.binding || null,
      toolCount: Number(service.toolCount || asArray(service.tools).length || 0),
      tools: asArray(service.tools).map((tool) => String(tool?.name || "").trim()).filter(Boolean).sort(),
      discoveredAt: String(service.discoveredAt || "").trim(),
      fingerprint: String(service.fingerprint || "").trim()
    };
  }
  return {
    schemaVersion: cache.schemaVersion,
    kind: cache.kind,
    updatedAt: cache.updatedAt,
    services
  };
}

function resolvePathValue(source, pathText = "") {
  if (!pathText) {
    return source;
  }
  let current = source;
  for (const segment of String(pathText).split(".").filter(Boolean)) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function renderTemplateValue(template, input, context = {}) {
  if (typeof template === "string") {
    if (template === "$input") {
      return input;
    }
    const inputMatch = template.match(/^\$input(?:\.([A-Za-z0-9_.-]+))?$/);
    if (inputMatch) {
      return inputMatch[1] ? resolvePathValue(input, inputMatch[1]) : input;
    }
    if (template === "$operationId") {
      return context.operationId || context.toolName || "";
    }
    if (template === "$tool.name") {
      return context.toolName || "";
    }
    if (template === "$request.id") {
      return context.requestId || "";
    }
    return template;
  }
  if (Array.isArray(template)) {
    return template.map((item) => renderTemplateValue(item, input, context));
  }
  if (template && typeof template === "object") {
    return Object.fromEntries(
      Object.entries(template).map(([key, value]) => [key, renderTemplateValue(value, input, context)])
    );
  }
  return template;
}

function renderPathTemplate(pathTemplate = "", input = {}) {
  const usedKeys = new Set();
  const templateText = pathTemplate === undefined || pathTemplate === null ? "/" : String(pathTemplate);
  let rendered = templateText.replace(/\{([^}]+)\}/g, (_, key) => {
    const name = String(key || "").trim();
    usedKeys.add(name);
    const value = resolvePathValue(input, name);
    return encodeURIComponent(value === undefined || value === null ? "" : String(value));
  });
  rendered = rendered.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, key) => {
    usedKeys.add(key);
    const value = resolvePathValue(input, key);
    return encodeURIComponent(value === undefined || value === null ? "" : String(value));
  });
  return {
    path: rendered === "" ? "" : rendered || "/",
    usedKeys
  };
}

function joinBaseUrlAndPath(baseUrl = "", routePath = "") {
  if (routePath === "") {
    return String(baseUrl || "").trim();
  }
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const cleanPath = String(routePath || "/").replace(/^\/+/, "");
  return new URL(cleanPath, base).toString();
}

function remainingObject(input = {}, usedKeys = new Set()) {
  return Object.fromEntries(
    Object.entries(asObject(input)).filter(([key]) => !usedKeys.has(key))
  );
}

function addQueryValue(url, key, value) {
  if (value === undefined || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      addQueryValue(url, key, item);
    }
    return;
  }
  if (typeof value === "object") {
    url.searchParams.set(key, JSON.stringify(value));
    return;
  }
  url.searchParams.set(key, String(value));
}

function openApiParameterNames(tool, location) {
  return asArray(tool.openapi?.parameters)
    .filter((parameter) => parameter?.in === location)
    .map((parameter) => String(parameter.name || "").trim())
    .filter(Boolean);
}

function buildCompiledHttpRequest({ service, tool, input }) {
  const baseUrl = String(tool.transport?.url || "").trim() || externalHttpBaseUrl(service);
  parseExplicitHttpUrl(baseUrl, "upstream.url");
  const method = String(tool.transport?.method || "POST").trim().toUpperCase();
  const routePath = tool.transport?.path === undefined || tool.transport?.path === null ? "/" : tool.transport.path;
  const { path: renderedPath, usedKeys } = renderPathTemplate(routePath, input);
  const url = new URL(joinBaseUrlAndPath(baseUrl, renderedPath));
  const request = asObject(tool.request);
  const context = {
    toolName: tool.name,
    operationId: tool.openapi?.operationId || tool.rpc?.method || tool.name,
    requestId: `pact-rpc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  };

  const queryNames = openApiParameterNames(tool, "query");
  if (request.query !== null && request.query !== undefined) {
    const query = renderTemplateValue(request.query, input, context);
    for (const [key, value] of Object.entries(asObject(query))) {
      usedKeys.add(key);
      addQueryValue(url, key, value);
    }
  } else if (queryNames.length) {
    for (const key of queryNames) {
      usedKeys.add(key);
      addQueryValue(url, key, resolvePathValue(input, key));
    }
  } else if (method === "GET" || method === "DELETE" || method === "HEAD") {
    for (const [key, value] of Object.entries(remainingObject(input, usedKeys))) {
      usedKeys.add(key);
      addQueryValue(url, key, value);
    }
  }

  const headers = {
    Accept: "application/json, text/plain",
    ...asObject(tool.transport?.headers),
    ...renderTemplateValue(asObject(request.headers), input, context)
  };
  let body = null;
  if (method !== "GET" && method !== "DELETE" && method !== "HEAD") {
    if (tool.rpc) {
      const rpc = asObject(tool.rpc);
      const params = renderTemplateValue(rpc.params === undefined ? "$input" : rpc.params, input, context);
      const id = renderTemplateValue(rpc.id === undefined ? "$request.id" : rpc.id, input, context);
      const rpcMethod = renderTemplateValue(rpc.method || tool.name, input, context);
      body = String(rpc.protocol || "json-rpc-2.0").trim() === "json-rpc-2.0"
        ? {
            jsonrpc: "2.0",
            id,
            method: rpcMethod,
            params
          }
        : {
            id,
            method: rpcMethod,
            params
          };
    } else if (request.body !== null && request.body !== undefined) {
      body = renderTemplateValue(request.body, input, context);
    } else if (tool.openapi?.hasRequestBody) {
      body = remainingObject(input, usedKeys);
    } else {
      body = remainingObject(input, usedKeys);
    }
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }
  return {
    url: url.toString(),
    init: {
      method,
      headers,
      ...(body === null ? {} : { body: JSON.stringify(body) })
    }
  };
}

async function parseHttpToolResponse(response) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }
  if (contentType.includes("json")) {
    return JSON.parse(text);
  }
  return text;
}

function applyResultPath(value, resultPath = "") {
  const pathText = String(resultPath || "").trim().replace(/^\$\.?/, "");
  if (!pathText) {
    return value;
  }
  return resolvePathValue(value, pathText);
}

async function callCompiledHttpTool({ service, toolName, input = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const tool = asArray(service.tools).find((item) => item?.name === toolName);
  if (!tool) {
    const error = new Error(`External HTTP tool is not registered: ${service.serviceId}/${toolName}`);
    error.code = "external_http_tool_not_registered";
    throw error;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs || DEFAULT_TIMEOUT_MS)));
  const startedAtMs = Date.now();
  try {
    const request = buildCompiledHttpRequest({
      service,
      tool,
      input: asObject(input)
    });
    const response = await fetch(request.url, {
      ...request.init,
      signal: controller.signal
    });
    const payload = await parseHttpToolResponse(response);
    if (!response.ok) {
      const error = new Error(`External HTTP tool ${toolName} returned HTTP ${response.status}.`);
      error.statusCode = response.status;
      error.payload = payload;
      throw error;
    }
    const durationMs = Date.now() - startedAtMs;
    const isRpc = service.upstream?.type === "rpc" || Boolean(tool.rpc);
    return {
      ok: true,
      protocolVersion: isRpc ? EXTERNAL_RPC_COMPILE_PROTOCOL_VERSION : EXTERNAL_HTTP_COMPILE_PROTOCOL_VERSION,
      serviceId: service.serviceId,
      upstreamToolName: toolName,
      upstream: {
        type: service.upstream?.type || "",
        transport: "http",
        url: externalHttpBaseUrl(service)
      },
      durationMs,
      result: applyResultPath(payload, tool.rpc?.resultPath || tool.response?.resultPath)
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function createExternalMcpPassthroughRuntime({ userDataPath = "", logger = null } = {}) {
  function getServiceFromCache(serviceId) {
    const cache = readCacheFileSync(userDataPath);
    return cache.services?.[String(serviceId || "").trim()] || null;
  }

  async function refreshConfig(config, options = {}) {
    return refreshExternalMcpToolCache({
      userDataPath,
      config,
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS
    });
  }

  async function callTool({ serviceId, toolName, input = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const service = getServiceFromCache(serviceId);
    if (!service) {
      const error = new Error(`External MCP service is not registered: ${serviceId}`);
      error.code = "external_mcp_service_not_registered";
      throw error;
    }
    if (service.upstream?.type !== "mcp") {
      const result = await callCompiledHttpTool({
        service,
        toolName,
        input,
        timeoutMs
      });
      logger?.info?.("external_http.tool_call.completed", {
        serviceId,
        toolName,
        durationMs: result.durationMs
      });
      return result;
    }
    const session = await initializeExternalMcpSession({
      config: {
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        displayName: service.displayName,
        upstream: service.upstream,
        binding: service.binding
      },
      timeoutMs
    });
    const startedAtMs = Date.now();
    const result = await postJsonRpc({
      url: session.url,
      sessionId: session.sessionId,
      timeoutMs,
      message: jsonRpcMessage("tools/call", {
        name: toolName,
        arguments: asObject(input)
      }, `pact-call-${Date.now().toString(36)}`)
    });
    const durationMs = Date.now() - startedAtMs;
    logger?.info?.("external_mcp.tool_call.completed", {
      serviceId,
      toolName,
      durationMs
    });
    return {
      ok: true,
      serviceId: service.serviceId,
      upstreamToolName: toolName,
      upstream: {
        type: "mcp",
        transport: service.upstream?.transport || "",
        url: service.upstream?.url || ""
      },
      durationMs,
      result: result.result
    };
  }

  return Object.freeze({
    protocolVersion: EXTERNAL_MCP_PROTOCOL_VERSION,
    refreshConfig,
    callTool,
    listVirtualOperationsSync: () => listExternalMcpVirtualOperationsSync({ userDataPath })
  });
}
