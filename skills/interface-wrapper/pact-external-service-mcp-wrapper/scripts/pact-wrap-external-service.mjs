#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../../..");
const EXTERNAL_SERVICE_KIND = "pact.external-service.config";

function parseArgs(argv = []) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function argText(args, key, fallback = "") {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  return [...new Set(asArray(values).map((value) => String(value || "").trim()).filter(Boolean))];
}

function inferKind(input = {}) {
  const kind = String(input.kind || input.type || input.serviceKind || "").trim().toLowerCase();
  if (kind === "json" || kind === "json-http" || kind === "custom-json") {
    return "json";
  }
  if (kind === "rest") {
    return "rest";
  }
  if (kind === "openapi" || input.spec || input.specUrl || input.specFile) {
    return "openapi";
  }
  if (kind === "rpc" || input.rpc || input.endpoints || input.rpcEndpoints) {
    return "rpc";
  }
  return "http";
}

function inferHttpType(urlText = "") {
  return String(urlText || "").trim().startsWith("https://") ? "https" : "http";
}

function toolName(raw = {}) {
  return String(raw.operationId || raw.operation_id || raw.name || raw.toolId || raw.id || raw.rpc?.method || "").trim();
}

function normalizeInputSchema(raw = {}) {
  return asObject(raw.inputSchema || raw.input_schema || raw.schema, { type: "object" });
}

function normalizeRpcTool(raw = {}) {
  const operationId = toolName(raw);
  const rpc = asObject(raw.rpc);
  return {
    operationId,
    ...(raw.label || raw.title ? { label: String(raw.label || raw.title).trim() } : {}),
    ...(raw.description ? { description: String(raw.description).trim() } : {}),
    rpc: {
      ...(rpc.endpointRef || rpc.endpoint || rpc.endpointId ? { endpointRef: String(rpc.endpointRef || rpc.endpoint || rpc.endpointId).trim() } : {}),
      ...(rpc.url ? { url: String(rpc.url).trim() } : {}),
      ...(rpc.path ? { path: String(rpc.path).trim() } : {}),
      ...(rpc.protocol ? { protocol: String(rpc.protocol).trim() } : {}),
      method: String(rpc.method || raw.method || operationId).trim(),
      params: rpc.params === undefined ? "$input" : rpc.params,
      resultPath: String(rpc.resultPath || rpc.result_path || raw.response?.resultPath || "result").trim()
    },
    inputSchema: normalizeInputSchema(raw),
    readOnly: raw.readOnly !== false,
    risk: String(raw.risk || "read_only").trim()
  };
}

function normalizeHttpTool(raw = {}) {
  const operationId = toolName(raw);
  const transport = asObject(raw.transport || raw.http);
  const request = asObject(raw.request);
  const response = asObject(raw.response);
  return {
    operationId,
    ...(raw.label || raw.title ? { label: String(raw.label || raw.title).trim() } : {}),
    ...(raw.description ? { description: String(raw.description).trim() } : {}),
    transport: {
      type: "http",
      method: String(transport.method || raw.method || "POST").trim().toUpperCase(),
      path: String(transport.path || raw.path || raw.endpointPath || "").trim(),
      ...(Object.keys(asObject(transport.headers)).length ? { headers: asObject(transport.headers) } : {})
    },
    ...(Object.keys(request).length ? { request } : {}),
    ...(Object.keys(response).length ? { response } : {}),
    inputSchema: normalizeInputSchema(raw),
    readOnly: raw.readOnly !== false,
    risk: String(raw.risk || "read_only").trim()
  };
}

function normalizeTools(input = {}, kind = "http") {
  return asArray(input.tools || input.operations || input.functions).map((tool) => {
    if (kind === "rpc" || tool?.rpc) {
      return normalizeRpcTool(tool);
    }
    return normalizeHttpTool(tool);
  });
}

function upstreamFromDescriptor(input = {}, kind = "http") {
  const upstream = asObject(input.upstream);
  const baseUrl = String(input.baseUrl || input.url || upstream.baseUrl || upstream.url || "").trim();
  if (kind === "openapi") {
    return {
      type: "openapi",
      baseUrl,
      ...(input.spec || upstream.spec ? { spec: input.spec || upstream.spec } : {}),
      ...(input.specUrl || upstream.specUrl ? { specUrl: String(input.specUrl || upstream.specUrl).trim() } : {}),
      ...(input.specFile || upstream.specFile ? { specFile: String(input.specFile || upstream.specFile).trim() } : {})
    };
  }
  if (kind === "rpc") {
    return {
      type: "rpc",
      protocol: String(input.protocol || upstream.protocol || "json-rpc-2.0").trim(),
      url: baseUrl,
      ...(input.path || input.rpcPath || upstream.path || upstream.rpcPath
        ? { path: String(input.path || input.rpcPath || upstream.path || upstream.rpcPath).trim() }
        : {}),
      ...(input.endpoints || input.rpcEndpoints || upstream.endpoints || upstream.rpcEndpoints
        ? { endpoints: input.endpoints || input.rpcEndpoints || upstream.endpoints || upstream.rpcEndpoints }
        : {})
    };
  }
  return {
    type: inferHttpType(baseUrl),
    url: baseUrl
  };
}

function buildConfig(input = {}) {
  if (input.kind === EXTERNAL_SERVICE_KIND) {
    return input;
  }
  const kind = inferKind(input);
  const serviceId = String(input.serviceId || input.id || "").trim();
  const serviceName = String(input.serviceName || input.name || `external.${kind}.${serviceId}`).trim();
  const binding = asObject(input.binding);
  const config = {
    schemaVersion: Number(input.schemaVersion || 2),
    kind: EXTERNAL_SERVICE_KIND,
    serviceId,
    serviceName,
    ...(input.displayName ? { displayName: String(input.displayName).trim() } : {}),
    mode: String(input.mode || "connected").trim(),
    startupPolicy: String(input.startupPolicy || "external-only").trim(),
    ...(input.description ? { description: String(input.description).trim() } : {}),
    upstream: upstreamFromDescriptor(input, kind),
    binding: {
      mode: "compile",
      outlet: "pact.skillHub",
      requiredScopes: uniqueStrings(binding.requiredScopes || input.requiredScopes || ["knowledge:read"]),
      risk: String(binding.risk || input.risk || "read_only").trim(),
      ...(Object.keys(asObject(binding.metadata)).length ? { metadata: asObject(binding.metadata) } : {})
    },
    tools: normalizeTools(input, kind)
  };
  return config;
}

async function loadJson(filePath) {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
}

async function importRegistry() {
  const modulePath = path.join(REPO_ROOT, "server/platform/common/composition-management/external-service-registry.mjs");
  return import(pathToFileURL(modulePath).href);
}

async function writeOutput(filePath, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (filePath) {
    await fs.mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
    await fs.writeFile(path.resolve(filePath), text, "utf8");
  } else {
    process.stdout.write(text);
  }
}

function apiEndpoint(apiUrl, routePath) {
  const base = new URL(String(apiUrl || "").trim());
  const route = routePath.startsWith("/") ? routePath : `/${routePath}`;
  const basePath = base.pathname.replace(/\/+$/, "");
  if (basePath === route || basePath.endsWith(route)) {
    return base.href;
  }
  if (basePath.endsWith("/api") && route.startsWith("/api/")) {
    base.pathname = `${basePath}${route.slice("/api".length)}`;
  } else {
    base.pathname = `${basePath}${route}`;
  }
  return base.href;
}

function apiHeaders(args = {}) {
  const authorization = String(args.authorization || process.env.PACT_API_AUTHORIZATION || "").trim();
  const token = String(args.token || process.env.PACT_API_TOKEN || process.env.PACT_CONSOLE_TOKEN || "").trim();
  const csrf = String(args.csrf || process.env.PACT_API_CSRF || process.env.PACT_CSRF_TOKEN || "").trim();
  const cookie = String(args.cookie || process.env.PACT_API_COOKIE || "").trim();
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-pact-safety-confirm": "true",
    ...(authorization ? { Authorization: authorization } : {}),
    ...(!authorization && token ? { Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}` } : {}),
    ...(csrf ? { "x-pact-csrf": csrf } : {}),
    ...(cookie ? { Cookie: cookie } : {})
  };
}

async function postApiJson({ apiUrl, routePath, payload, args }) {
  const endpoint = apiEndpoint(apiUrl, routePath);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: apiHeaders(args),
    body: JSON.stringify(payload)
  });
  const rawText = await response.text();
  let data = null;
  try {
    data = rawText.trim() ? JSON.parse(rawText) : {};
  } catch {
    data = { ok: false, rawText };
  }
  if (!response.ok) {
    const message = data?.error || data?.message || rawText || `Pact API request failed: ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.response = data;
    throw error;
  }
  return data;
}

async function saveViaPactApi({ apiUrl, config, args }) {
  const saveResult = await postApiJson({
    apiUrl,
    routePath: "/api/external-services/config",
    payload: { configText: JSON.stringify(config, null, 2) },
    args
  });
  let refreshResult = null;
  if (args["no-refresh"] !== true) {
    refreshResult = await postApiJson({
      apiUrl,
      routePath: "/api/external-services/refresh",
      payload: { serviceId: config.serviceId },
      args
    });
  }
  return {
    ok: saveResult?.ok !== false && (!refreshResult || refreshResult?.ok !== false),
    mode: "api",
    apiUrl: String(apiUrl || "").trim(),
    serviceId: config.serviceId,
    save: saveResult,
    ...(refreshResult ? { refresh: refreshResult } : {})
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input && !args.config) {
    process.stderr.write("Usage: pact-wrap-external-service.mjs --input descriptor.json [--output config.json] [--save --user-data-path PATH | --save --api-url URL]\n");
    process.exit(2);
  }

  const input = await loadJson(String(args.input || args.config));
  const config = buildConfig(input);
  const registry = await importRegistry();
  const verification = await registry.verifyExternalServiceConfigPayload({
    payload: { config },
    cwd: REPO_ROOT,
    requireKnownPaths: false
  });
  if (!verification.ok) {
    await writeOutput(String(args.output || ""), {
      ok: false,
      config,
      validation: verification.validation
    });
    process.exit(2);
  }

  if (args.save) {
    const apiUrl = argText(args, "api-url");
    if (apiUrl) {
      const saved = await saveViaPactApi({
        apiUrl,
        config: verification.config,
        args
      });
      await writeOutput(argText(args, "output"), saved);
      process.exit(saved.ok ? 0 : 2);
    }
    const saved = await registry.saveExternalServiceConfig({
      userDataPath: String(args["user-data-path"] || process.env.PACT_SERVER_DATA_DIR || ""),
      cwd: REPO_ROOT,
      payload: { config: verification.config }
    });
    await writeOutput(argText(args, "output"), saved);
    process.exit(saved.ok ? 0 : 2);
  }

  await writeOutput(argText(args, "output"), verification.config);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
