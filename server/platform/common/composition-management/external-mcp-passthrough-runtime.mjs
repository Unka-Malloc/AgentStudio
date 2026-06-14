import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { ServerConfig } from "../config/ServerConfig.mjs";
import { resolveLocalSecretPayload } from "../security/secrets/local-secret-store.mjs";
import {
  assertExternalServiceRuntimeEgressAllowed,
  evaluateExternalServiceRedirectLocationWithDns,
  fetchExternalServiceWithPinnedDns
} from "./external-service-egress-policy.mjs";

export const EXTERNAL_MCP_CACHE_KIND = "pact.external-mcp.tool-cache";
export const EXTERNAL_MCP_VIRTUAL_OPERATION_ASPECT = "external-mcp-passthrough";
export const EXTERNAL_MCP_PROTOCOL_VERSION = "v0.0.1:external-service:mcp-passthrough-1";
export const EXTERNAL_HTTP_COMPILE_VIRTUAL_OPERATION_ASPECT = "external-http-compile";
export const EXTERNAL_HTTP_COMPILE_PROTOCOL_VERSION = "v0.0.1:external-service:http-compile-1";
export const EXTERNAL_RPC_COMPILE_VIRTUAL_OPERATION_ASPECT = "external-rpc-compile";
export const EXTERNAL_RPC_COMPILE_PROTOCOL_VERSION = "v0.0.1:external-service:rpc-compile-1";
export const EXTERNAL_MODEL_GATEWAY_VIRTUAL_OPERATION_ASPECT = "external-model-gateway-compile";
export const EXTERNAL_MODEL_GATEWAY_PROTOCOL_VERSION = "v0.0.1:external-service:model-gateway-1";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_LEGACY_SSE_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_EXTERNAL_SERVICE_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_MCP_SSE_EVENTS_PER_REQUEST = 128;
const HTTP_COMPILE_UPSTREAM_TYPES = new Set(["http", "https", "openapi", "rpc", "json-rpc", "sse", "llm"]);
const OPENAI_MODEL_PROTOCOLS = new Set(["openai-compatible", "openai-responses"]);
const RAW_MCP_RUNTIME_TRANSPORTS = new Set(["streamable-http", "sse"]);
const SERVICEHUB_PRODUCTION_POLICY_PRESET = "servicehub.production-default";
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const SERVICEHUB_TOOL_ADOPTION_PROTOCOL_VERSION = "v0.0.1:external-service:servicehub-tool-adoption-1";
const SERVICEHUB_TOOL_REVIEW_PROTOCOL_VERSION = "v0.0.1:external-service:servicehub-tool-review-1";
const SERVICEHUB_TOOL_VERSION_PROTOCOL_VERSION = "v0.0.1:external-service:servicehub-tool-version-1";
const SERVICEHUB_BASE_PRODUCTION_GATES = Object.freeze([
  "template-static-validation",
  "manifest-bound-invocation",
  "egress-ssrf-dns-redirect-verifier",
  "secretstore-binding-and-redaction",
  "tool-adoption-gate",
  "grant-projection",
  "quota-bulkhead-deadline",
  "error-taxonomy-and-retry-hint",
  "external-call-receipt",
  "output-governance"
]);
const TOOL_REVIEW_TEXT_LIMIT = 240;
const TOOL_REVIEW_SCHEMA_PROPERTY_LIMIT = 24;
const MAX_ROLLBACK_VERSIONS = 5;
const TOOL_RISK_RANK = Object.freeze({
  read_only: 0,
  safe_write: 1,
  repair_write: 2,
  destructive: 3
});
const TOOL_PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(previous|all|system|developer)/i,
  /(reveal|expose|print|return)\s+(secret|token|api[-_ ]?key|password|credential)/i,
  /(system|developer)\s+prompt/i,
  /exfiltrat/i,
  /bypass\s+(policy|permission|authorization|guardrail)/i,
  /send\s+.*(secret|token|credential)/i
];
const SAFE_JSON_SCHEMA_PATTERN_MAX_LENGTH = 160;
const SERVICEHUB_RUNTIME_INVALIDATION_SCOPES = Object.freeze([
  "tool-management-catalog",
  "mcp-tools-list",
  "grant-projection",
  "external-service-runtime-cache",
  "external-service-health-state",
  "upstream-session"
]);

function hasServiceHubEgressEnvelope(source = {}) {
  return Boolean(source?.policyPreset || source?.policies);
}

function serviceWithRuntimePolicyEnvelope(service = {}) {
  if (!service || typeof service !== "object" || Array.isArray(service)) {
    return service;
  }
  if (hasServiceHubEgressEnvelope(service)) {
    return service;
  }
  return {
    ...service,
    policyPreset: SERVICEHUB_PRODUCTION_POLICY_PRESET
  };
}

function summarizeServiceHubEgressDecision(decision = null) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    return null;
  }
  const dns = decision.dns && typeof decision.dns === "object" && !Array.isArray(decision.dns)
    ? decision.dns
    : null;
  const dnsAddresses = asArray(dns?.addresses);
  const addressCategories = uniqueStrings(dnsAddresses.map((record) => record?.addressCategory));
  const restrictedAddressCategories = uniqueStrings(dnsAddresses
    .filter((record) => record?.restricted)
    .map((record) => record?.addressCategory));
  return {
    schemaVersion: String(decision.schemaVersion || ""),
    ok: decision.ok === true,
    label: String(decision.label || ""),
    protocol: String(decision.protocol || ""),
    host: String(decision.host || ""),
    port: String(decision.port || ""),
    hostKind: String(decision.hostKind || ""),
    addressCategory: String(decision.addressCategory || ""),
    allowLocalForDevelopment: decision.allowLocalForDevelopment === true,
    reason: String(decision.reason || ""),
    ...(dns ? {
      dns: {
        status: String(dns.status || ""),
        host: String(dns.host || ""),
        addressCount: Math.max(0, Number(dns.addressCount || dnsAddresses.length || 0) || 0),
        restrictedAddressCount: Math.max(0, Number(dns.restrictedAddressCount || 0) || 0),
        addressCategories,
        restrictedAddressCategories
      }
    } : {})
  };
}

async function assertServiceHubRuntimeEgressAllowed(source = {}, url = "", label = "upstream.url") {
  if (!hasServiceHubEgressEnvelope(source)) {
    return null;
  }
  try {
    const decision = await assertExternalServiceRuntimeEgressAllowed({
      url,
      label,
      policyPreset: source.policyPreset,
      policies: source.policies
    });
    return summarizeServiceHubEgressDecision(decision);
  } catch (error) {
    error.egressDecision = summarizeServiceHubEgressDecision(error?.decision);
    throw error;
  }
}

async function fetchServiceHubRuntimeWithPinnedDns(source = {}, url = "", label = "upstream.url", init = {}) {
  if (!hasServiceHubEgressEnvelope(source)) {
    return {
      response: await fetch(url, init),
      egressDecision: null,
      async close() {}
    };
  }
  try {
    const result = await fetchExternalServiceWithPinnedDns({
      url,
      label,
      policyPreset: source.policyPreset,
      policies: source.policies,
      init
    });
    return {
      response: result.response,
      egressDecision: summarizeServiceHubEgressDecision(result.decision),
      pinnedDns: result.pinnedDns,
      close: result.close
    };
  } catch (error) {
    error.egressDecision = summarizeServiceHubEgressDecision(error?.decision);
    throw error;
  }
}

async function evaluateServiceHubRedirectDecision(source = {}, {
  sourceUrl = "",
  status = 0,
  location = "",
  label = "redirect.location"
} = {}) {
  if (!hasServiceHubEgressEnvelope(source)) {
    return null;
  }
  return evaluateExternalServiceRedirectLocationWithDns({
    sourceUrl,
    status,
    location,
    label,
    policyPreset: source.policyPreset,
    policies: source.policies
  });
}

function isHttpRedirectStatus(status) {
  const value = Number(status || 0);
  return Number.isInteger(value) && value >= 300 && value < 400;
}

function combineAbortSignals(signals = []) {
  const activeSignals = asArray(signals).filter((signal) =>
    signal && typeof signal === "object" && typeof signal.addEventListener === "function"
  );
  if (activeSignals.length === 0) {
    return {
      signal: undefined,
      cleanup() {}
    };
  }
  if (activeSignals.length === 1) {
    return {
      signal: activeSignals[0],
      cleanup() {}
    };
  }
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };
  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    cleanup() {
      for (const signal of activeSignals) {
        signal.removeEventListener?.("abort", abort);
      }
    }
  };
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function schemaTypeList(schema = {}) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return [];
  }
  if (Array.isArray(schema.type)) {
    return schema.type.map((type) => String(type || "").trim()).filter(Boolean);
  }
  const type = String(schema.type || "").trim();
  return type ? [type] : [];
}

function jsonSchemaValueEquals(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return left === right;
  }
}

function jsonSchemaSubschemas(schema = {}, keyword = "") {
  const value = schema?.[keyword];
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item))
    : [];
}

function validateSafeJsonSchemaPattern(pattern = "") {
  const patternText = String(pattern);
  if (patternText.length > SAFE_JSON_SCHEMA_PATTERN_MAX_LENGTH) {
    return {
      ok: false,
      error: `pattern exceeds ${SAFE_JSON_SCHEMA_PATTERN_MAX_LENGTH} characters`
    };
  }
  if (/\\[1-9]/.test(patternText)) {
    return { ok: false, error: "backreferences are not supported" };
  }
  if (/\(\?/.test(patternText)) {
    return { ok: false, error: "lookaround and advanced group syntax are not supported" };
  }
  if (/\([^)]*[*+][^)]*\)\s*(?:[*+?]|\{\d*,?\d*\})/.test(patternText)) {
    return { ok: false, error: "nested quantified groups are not supported" };
  }
  if ((patternText.match(/\.\*/g) || []).length > 1) {
    return { ok: false, error: "multiple wildcard repetitions are not supported" };
  }
  try {
    return { ok: true, regex: new RegExp(patternText, "u") };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "invalid regular expression"
    };
  }
}

function isValidJsonSchemaDate(value = "") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day);
}

function isValidJsonSchemaHostname(value = "") {
  const text = String(value || "").trim();
  if (!text || text.length > 253 || text.endsWith(".")) {
    return false;
  }
  return text.split(".").every((label) =>
    label.length > 0 &&
    label.length <= 63 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  );
}

function stringMatchesJsonSchemaFormat(value = "", format = "") {
  const normalized = String(format || "").trim().toLowerCase();
  if (!normalized) {
    return { ok: true };
  }
  switch (normalized) {
    case "email":
      return { ok: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) };
    case "uri":
      try {
        new URL(value);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    case "url":
      try {
        const parsed = new URL(value);
        return { ok: ["http:", "https:"].includes(parsed.protocol) };
      } catch {
        return { ok: false };
      }
    case "uuid":
      return { ok: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) };
    case "date":
      return { ok: isValidJsonSchemaDate(value) };
    case "date-time":
      return {
        ok: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
          Number.isFinite(Date.parse(value))
      };
    case "time":
      return { ok: /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-][01]\d:[0-5]\d)?$/.test(value) };
    case "ipv4":
      return { ok: isIP(value) === 4 };
    case "ipv6":
      return { ok: isIP(value) === 6 };
    case "hostname":
      return { ok: isValidJsonSchemaHostname(value) };
    default:
      return {
        ok: false,
        unsupported: true,
        format: normalized
      };
  }
}

function valueMatchesSchemaType(value, type = "") {
  switch (type) {
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return Boolean(value && typeof value === "object" && !Array.isArray(value));
    case "string":
      return typeof value === "string";
    default:
      return true;
  }
}

function validateExternalToolInputValueAgainstSchema({
  operationId = "",
  schema = {},
  value,
  path = "input"
} = {}) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { ok: true };
  }
  const types = schemaTypeList(schema);
  if (types.length && !types.some((type) => valueMatchesSchemaType(value, type))) {
    return {
      ok: false,
      error: `External tool ${operationId} ${path} must be ${types.join(" or ")}.`
    };
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => jsonSchemaValueEquals(item, value))) {
    return {
      ok: false,
      error: `External tool ${operationId} ${path} must be one of the declared enum values.`
    };
  }
  if (Object.prototype.hasOwnProperty.call(schema, "const") && !jsonSchemaValueEquals(schema.const, value)) {
    return {
      ok: false,
      error: `External tool ${operationId} ${path} must match the declared const value.`
    };
  }
  for (const [index, subschema] of jsonSchemaSubschemas(schema, "allOf").entries()) {
    const validation = validateExternalToolInputValueAgainstSchema({
      operationId,
      schema: subschema,
      value,
      path
    });
    if (!validation.ok) {
      return {
        ok: false,
        error: `External tool ${operationId} ${path} must satisfy allOf[${index}]: ${validation.error}`
      };
    }
  }
  const anyOf = jsonSchemaSubschemas(schema, "anyOf");
  if (anyOf.length) {
    const matched = anyOf.some((subschema) => validateExternalToolInputValueAgainstSchema({
      operationId,
      schema: subschema,
      value,
      path
    }).ok);
    if (!matched) {
      return {
        ok: false,
        error: `External tool ${operationId} ${path} must satisfy at least one anyOf schema.`
      };
    }
  }
  const oneOf = jsonSchemaSubschemas(schema, "oneOf");
  if (oneOf.length) {
    const matchCount = oneOf.filter((subschema) => validateExternalToolInputValueAgainstSchema({
      operationId,
      schema: subschema,
      value,
      path
    }).ok).length;
    if (matchCount !== 1) {
      return {
        ok: false,
        error: `External tool ${operationId} ${path} must satisfy exactly one oneOf schema.`
      };
    }
  }
  if (schema.not && typeof schema.not === "object" && !Array.isArray(schema.not)) {
    const validation = validateExternalToolInputValueAgainstSchema({
      operationId,
      schema: schema.not,
      value,
      path
    });
    if (validation.ok) {
      return {
        ok: false,
        error: `External tool ${operationId} ${path} must not match the declared not schema.`
      };
    }
  }
  if (typeof value === "string") {
    const minLength = Number(schema.minLength);
    const maxLength = Number(schema.maxLength);
    if (Number.isFinite(minLength) && value.length < minLength) {
      return {
        ok: false,
        error: `External tool ${operationId} ${path} must be at least ${minLength} characters.`
      };
    }
    if (Number.isFinite(maxLength) && value.length > maxLength) {
      return {
        ok: false,
        error: `External tool ${operationId} ${path} must be at most ${maxLength} characters.`
      };
    }
    if (Object.prototype.hasOwnProperty.call(schema, "pattern")) {
      const patternValidation = validateSafeJsonSchemaPattern(schema.pattern);
      if (!patternValidation.ok) {
        return {
          ok: false,
          error: `External tool ${operationId} ${path} uses unsupported pattern: ${patternValidation.error}.`
        };
      }
      if (!patternValidation.regex.test(value)) {
        return {
          ok: false,
          error: `External tool ${operationId} ${path} must match the declared pattern.`
        };
      }
    }
    if (schema.format) {
      const formatValidation = stringMatchesJsonSchemaFormat(value, schema.format);
      if (formatValidation.unsupported) {
        return {
          ok: false,
          error: `External tool ${operationId} ${path} uses unsupported string format: ${formatValidation.format}.`
        };
      }
      if (!formatValidation.ok) {
        return {
          ok: false,
          error: `External tool ${operationId} ${path} must match format ${String(schema.format).trim()}.`
        };
      }
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const minimum = Number(schema.minimum);
    const maximum = Number(schema.maximum);
    if (Number.isFinite(minimum) && value < minimum) {
      return {
        ok: false,
        error: `External tool ${operationId} ${path} must be at least ${minimum}.`
      };
    }
    if (Number.isFinite(maximum) && value > maximum) {
      return {
        ok: false,
        error: `External tool ${operationId} ${path} must be at most ${maximum}.`
      };
    }
  }
  if (Array.isArray(value)) {
    const minItems = Number(schema.minItems);
    const maxItems = Number(schema.maxItems);
    if (Number.isFinite(minItems) && value.length < minItems) {
      return {
        ok: false,
        error: `External tool ${operationId} ${path} must contain at least ${minItems} items.`
      };
    }
    if (Number.isFinite(maxItems) && value.length > maxItems) {
      return {
        ok: false,
        error: `External tool ${operationId} ${path} must contain at most ${maxItems} items.`
      };
    }
    if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
      for (let index = 0; index < value.length; index += 1) {
        const itemValidation = validateExternalToolInputValueAgainstSchema({
          operationId,
          schema: schema.items,
          value: value[index],
          path: `${path}[${index}]`
        });
        if (!itemValidation.ok) {
          return itemValidation;
        }
      }
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
      ? schema.properties
      : {};
    for (const key of asArray(schema.required)) {
      if (value[key] === undefined || value[key] === null || value[key] === "") {
        return {
          ok: false,
          error: `External tool ${operationId} missing required input: ${path}.${key}.`
        };
      }
    }
    const maxProperties = Number(schema.maxProperties);
    if (Number.isFinite(maxProperties) && Object.keys(value).length > maxProperties) {
      return {
        ok: false,
        error: `External tool ${operationId} ${path} must contain at most ${maxProperties} properties.`
      };
    }
    for (const [key, entryValue] of Object.entries(value)) {
      const propertySchema = properties[key];
      if (!propertySchema) {
        if (schema.additionalProperties === false) {
          return {
            ok: false,
            error: `External tool ${operationId} received undeclared input: ${path}.${key}.`
          };
        }
        if (schema.additionalProperties && typeof schema.additionalProperties === "object" && !Array.isArray(schema.additionalProperties)) {
          const additionalValidation = validateExternalToolInputValueAgainstSchema({
            operationId,
            schema: schema.additionalProperties,
            value: entryValue,
            path: `${path}.${key}`
          });
          if (!additionalValidation.ok) {
            return additionalValidation;
          }
        }
        continue;
      }
      if (entryValue === undefined || entryValue === null) {
        continue;
      }
      const propertyValidation = validateExternalToolInputValueAgainstSchema({
        operationId,
        schema: propertySchema,
        value: entryValue,
        path: `${path}.${key}`
      });
      if (!propertyValidation.ok) {
        return propertyValidation;
      }
    }
  }
  return { ok: true };
}

function validateExternalToolInputSchema({ service = {}, tool = {}, input = {} } = {}) {
  const schema = tool?.inputSchema || { type: "object" };
  const operationId = `${service?.serviceId || "external-service"}/${tool?.name || "unknown"}`;
  const topLevelTypes = schemaTypeList(schema);
  if (topLevelTypes.length && !topLevelTypes.includes("object")) {
    return;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    const error = new Error(`External tool ${operationId} requires object input.`);
    error.code = "external_tool_input_schema_validation_failed";
    error.statusCode = 400;
    error.serviceId = String(service?.serviceId || "").trim();
    error.toolName = String(tool?.name || "").trim();
    throw error;
  }
  const validation = validateExternalToolInputValueAgainstSchema({
    operationId,
    schema,
    value: input,
    path: "input"
  });
  if (!validation.ok) {
    const error = new Error(validation.error || `External tool ${operationId} input failed schema validation.`);
    error.code = "external_tool_input_schema_validation_failed";
    error.statusCode = 400;
    error.serviceId = String(service?.serviceId || "").trim();
    error.toolName = String(tool?.name || "").trim();
    throw error;
  }
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

function safeHeaderMap(headers = {}) {
  return Object.fromEntries(
    Object.entries(asObject(headers))
      .filter(([key, value]) => !isSensitiveHeaderName(key) && !isLiteralCredentialHeaderValue(value))
      .map(([key, value]) => [key, String(value)])
  );
}

function trustedHeaderMap(headers = {}) {
  return Object.fromEntries(
    Object.entries(asObject(headers)).map(([key, value]) => [key, String(value)])
  );
}

function publicAuthDescriptor(auth = null) {
  const source = asObject(auth, null);
  if (!source) {
    return null;
  }
  const secretRef = String(source.secretRef || "").trim();
  if (!secretRef) {
    return null;
  }
  return {
    ...(source.type ? { type: String(source.type).trim() } : {}),
    ...(source.scheme ? { scheme: String(source.scheme).trim() } : {}),
    secretRef,
    ...(source.headerName ? { headerName: String(source.headerName).trim() } : {}),
    ...(source.metadata ? { metadata: asObject(source.metadata) } : {})
  };
}

function upstreamRuntimeDescriptor(configUpstream = {}, discoveryUpstream = {}) {
  const upstream = asObject(configUpstream);
  const discovered = asObject(discoveryUpstream);
  const auth = publicAuthDescriptor(upstream.auth);
  return {
    ...discovered,
    ...(auth ? { auth } : {}),
    ...(upstream.defaultHeaders ? { defaultHeaders: safeHeaderMap(upstream.defaultHeaders) } : {}),
    ...(upstream.timeoutMs ? { timeoutMs: upstream.timeoutMs } : {})
  };
}

function payloadText(payload = {}, paths = []) {
  for (const pathText of paths) {
    const value = resolvePathValue(payload, pathText);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeAuthType(auth = {}) {
  return String(auth.type || auth.scheme || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function expectedSecretScopeForUpstream({
  serviceId = "",
  url = "",
  requiredScopes = [],
  tenantId = "",
  workspaceId = "",
  authBindingId = ""
} = {}) {
  let parsed = null;
  try {
    parsed = url ? new URL(String(url || "").trim()) : null;
  } catch {
    parsed = null;
  }
  return {
    ...(serviceId ? { serviceId: String(serviceId || "").trim() } : {}),
    ...(tenantId ? { tenantId: String(tenantId || "").trim() } : {}),
    ...(workspaceId ? { workspaceId: String(workspaceId || "").trim() } : {}),
    ...(authBindingId ? { authBindingId: String(authBindingId || "").trim() } : {}),
    ...(parsed?.hostname ? { host: parsed.hostname.toLowerCase() } : {}),
    ...(parsed?.protocol ? { protocol: parsed.protocol.replace(/:$/, "").toLowerCase() } : {}),
    ...(asArray(requiredScopes).length ? { scopes: asArray(requiredScopes) } : {})
  };
}

async function resolveUpstreamAuthHeaders({
  upstream = {},
  userDataPath = "",
  serviceId = "",
  url = "",
  requiredScopes = [],
  tenantId = "",
  workspaceId = "",
  authBindingId = ""
} = {}) {
  const auth = asObject(upstream.auth, null);
  const secretRef = String(auth?.secretRef || "").trim();
  if (!auth || !secretRef) {
    return {};
  }
  const secret = await resolveLocalSecretPayload({
    dataDir: userDataPath,
    secretRef,
    expectedScope: expectedSecretScopeForUpstream({
      serviceId,
      url,
      requiredScopes,
      tenantId,
      workspaceId,
      authBindingId: authBindingId || auth?.metadata?.authBindingId || auth?.metadata?.bindingId || ""
    })
  });
  const payload = asObject(secret.payload);
  const authType = normalizeAuthType(auth) || normalizeAuthType({ type: secret.authType });
  if (authType === "bearer" || authType === "token" || authType === "oauth2") {
    const token = payloadText(payload, [
      "token",
      "accessToken",
      "access_token",
      "apiKey",
      "api_key",
      "oauth.accessToken",
      "oauth.access_token"
    ]);
    if (!token) {
      throw new Error(`Pact local secret ${secretRef} does not contain a bearer token value.`);
    }
    return { Authorization: `Bearer ${token}` };
  }
  if (authType === "api-key" || authType === "apikey") {
    const apiKey = payloadText(payload, ["apiKey", "api_key", "token"]);
    if (!apiKey) {
      throw new Error(`Pact local secret ${secretRef} does not contain an API key value.`);
    }
    const headerName = String(auth.headerName || auth.metadata?.headerName || "X-API-Key").trim();
    return { [headerName]: apiKey };
  }
  if (authType === "basic") {
    const username = payloadText(payload, ["username", "user", "login"]);
    const password = payloadText(payload, ["password", "httpPassword", "token"]);
    if (!username || !password) {
      throw new Error(`Pact local secret ${secretRef} does not contain basic auth username/password values.`);
    }
    return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
  }
  throw new Error(`ServiceHub upstream auth type is not supported at runtime: ${authType || "missing"}.`);
}

function nowIso() {
  return new Date().toISOString();
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function serviceHubRequiredProductionGateIds(service = {}) {
  const upstream = asObject(service.upstream);
  const type = String(upstream.type || "").trim();
  const transport = String(upstream.transport || "").trim();
  const gates = [...SERVICEHUB_BASE_PRODUCTION_GATES];
  if (type === "mcp") {
    gates.push("mcp-capability-firewall", "upstream-tools-list-adoption");
    if (transport === "sse") {
      gates.push("streaming-and-backpressure");
    }
  } else if (type === "http" || type === "openapi" || type === "https") {
    gates.push("mapping-sandbox", "outbound-payload-governance");
    if (type === "https") {
      gates.push("tls-verification");
    }
  } else if (type === "rpc" || type === "json-rpc") {
    gates.push("mapping-sandbox", "json-rpc-id-correlation", "json-rpc-error-mapping");
  } else if (type === "sse") {
    gates.push("streaming-and-backpressure", "event-output-governance");
  } else if (type === "llm") {
    gates.push("model-gateway-runtime-verifier", "model-output-redaction", "model-budget-quota");
  }
  return uniqueStrings(gates);
}

function serviceHubProductionEvidenceRequired(service = {}) {
  const policies = asObject(service.policies);
  const verification = asObject(policies.verification);
  return String(service.policyPreset || "").trim() === SERVICEHUB_PRODUCTION_POLICY_PRESET ||
    verification.required === true ||
    verification.failClosed === true;
}

function serviceHubProductionGateRecords(service = {}) {
  const evidence = asObject(service.evidence);
  const productionGateEvidence = asObject(service.productionGateEvidence, null);
  if (Array.isArray(productionGateEvidence?.gates)) {
    return productionGateEvidence.gates;
  }
  if (Array.isArray(service.productionGates)) {
    return service.productionGates;
  }
  if (Array.isArray(evidence.productionGates)) {
    return evidence.productionGates;
  }
  return [];
}

function productionGateEvidenceError({ service = {}, missingGateIds = [], invalidGateIds = [], reasonCode = "" } = {}) {
  const error = new Error(`ServiceHub production verifier evidence is required before exposing external service tools: ${service.serviceId || "unknown"}`);
  error.code = "servicehub_verifier_evidence_required";
  error.statusCode = 409;
  error.serviceId = String(service.serviceId || "").trim();
  error.reasonCode = reasonCode || "production_gate_evidence_missing";
  error.missingGateIds = uniqueStrings(missingGateIds);
  error.invalidGateIds = uniqueStrings(invalidGateIds);
  return error;
}

function digestValue(value) {
  return `sha256:${fingerprint(value)}`;
}

function recordWithoutDigest(record = {}) {
  const { recordDigest, ...rest } = asObject(record);
  return rest;
}

function productionGateDigestValid(record = {}) {
  const evidenceDigest = String(record.evidenceDigest || "").trim();
  const recordDigest = String(record.recordDigest || "").trim();
  if (!/^sha256:[a-f0-9]{64}$/i.test(evidenceDigest) || !/^sha256:[a-f0-9]{64}$/i.test(recordDigest)) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(record, "evidencePayload") && evidenceDigest !== digestValue(record.evidencePayload)) {
    return false;
  }
  return recordDigest === digestValue(recordWithoutDigest(record));
}

function evaluateServiceHubProductionEvidence(service = {}, {
  candidateVersion = null,
  require = serviceHubProductionEvidenceRequired(service)
} = {}) {
  if (!require) {
    return { ok: true, required: false, missingGateIds: [], invalidGateIds: [] };
  }
  const requiredGateIds = serviceHubRequiredProductionGateIds(service);
  const records = serviceHubProductionGateRecords(service);
  const recordsByGateId = new Map(records
    .map((record) => [String(record?.gateId || record?.id || "").trim(), asObject(record)])
    .filter(([gateId]) => Boolean(gateId)));
  const serviceManifestFingerprint = String(service.manifestFingerprint || "").trim();
  const candidateFingerprint = String(
    candidateVersion?.fingerprint ||
      service.productionEvidenceCandidateFingerprint ||
      service.activeVersion?.promotedCandidateFingerprint ||
      service.candidateVersion?.fingerprint ||
      ""
  ).trim();
  const missingGateIds = [];
  const invalidGateIds = [];
  for (const gateId of requiredGateIds) {
    const record = recordsByGateId.get(gateId);
    if (!record) {
      missingGateIds.push(gateId);
      continue;
    }
    const status = String(record.status || record.decision || "").trim();
    const verifierId = String(record.verifierId || record.verifier || "").trim();
    const evidenceRef = String(record.evidenceRef || record.evidenceId || record.receiptRef || "").trim();
    const verifiedAt = String(record.verifiedAt || record.checkedAt || record.generatedAt || "").trim();
    const manifestFingerprint = String(record.manifestFingerprint || "").trim();
    const recordCandidateFingerprint = String(record.candidateFingerprint || record.candidateVersionFingerprint || "").trim();
    const subjectFingerprint = String(record.subjectFingerprint || "").trim();
    const manifestBound = serviceManifestFingerprint
      ? manifestFingerprint === serviceManifestFingerprint || subjectFingerprint === serviceManifestFingerprint
      : true;
    const candidateBound = candidateFingerprint
      ? recordCandidateFingerprint === candidateFingerprint || subjectFingerprint === candidateFingerprint
      : true;
    if (
      status !== "passed" ||
      !verifierId ||
      !evidenceRef ||
      !verifiedAt ||
      !manifestBound ||
      !candidateBound ||
      !productionGateDigestValid(record)
    ) {
      invalidGateIds.push(gateId);
    }
  }
  return {
    ok: missingGateIds.length === 0 && invalidGateIds.length === 0,
    required: true,
    missingGateIds: uniqueStrings(missingGateIds),
    invalidGateIds: uniqueStrings(invalidGateIds),
    requiredGateIds
  };
}

function assertServiceHubProductionEvidence(service = {}, options = {}) {
  const evaluation = evaluateServiceHubProductionEvidence(service, options);
  if (!evaluation.ok) {
    throw productionGateEvidenceError({
      service,
      missingGateIds: evaluation.missingGateIds,
      invalidGateIds: evaluation.invalidGateIds,
      reasonCode: evaluation.missingGateIds.length ? "production_gate_evidence_missing" : "production_gate_evidence_invalid"
    });
  }
  return evaluation;
}

function assertServiceHubCallableTool(service = {}, tool = null, { legacyActive = false } = {}) {
  const productionEvidenceRequired = serviceHubProductionEvidenceRequired(service);
  const activeToolRequired = productionEvidenceRequired || legacyToolCacheMigration(service)?.required === true;
  if (activeToolRequired && (!tool || !isAdoptedExternalTool(tool, { legacyActive }))) {
    const error = new Error(`ServiceHub external tool is not active or adopted: ${service.serviceId || "unknown"}/${tool?.name || "unknown"}`);
    error.code = "servicehub_tool_not_active";
    error.statusCode = 404;
    error.serviceId = String(service.serviceId || "").trim();
    error.toolName = String(tool?.name || "").trim();
    throw error;
  }
  if (productionEvidenceRequired) {
    assertServiceHubProductionEvidence(service);
  }
}

function textPreview(value = "", limit = TOOL_REVIEW_TEXT_LIMIT) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function summarizeSchemaProperty(name = "", property = {}, requiredNames = new Set()) {
  const schema = asObject(property);
  const type = Array.isArray(schema.type)
    ? schema.type.map((item) => String(item || "").trim()).filter(Boolean).join("|")
    : String(schema.type || "").trim();
  return {
    name: String(name || "").trim(),
    ...(type ? { type } : {}),
    required: requiredNames.has(String(name || "").trim()),
    ...(schema.format ? { format: String(schema.format).trim() } : {}),
    ...(schema.enum ? { enumCount: asArray(schema.enum).length } : {})
  };
}

function summarizeInputSchema(inputSchema = {}) {
  const schema = asObject(inputSchema);
  const required = uniqueStrings(asArray(schema.required));
  const requiredNames = new Set(required);
  const properties = asObject(schema.properties);
  const propertyNames = Object.keys(properties).sort();
  return {
    type: String(schema.type || "object").trim(),
    fingerprint: fingerprint(schema),
    required,
    propertyCount: propertyNames.length,
    properties: propertyNames
      .slice(0, TOOL_REVIEW_SCHEMA_PROPERTY_LIMIT)
      .map((name) => summarizeSchemaProperty(name, properties[name], requiredNames)),
    truncated: propertyNames.length > TOOL_REVIEW_SCHEMA_PROPERTY_LIMIT,
    additionalProperties: schema.additionalProperties === undefined
      ? "unspecified"
      : schema.additionalProperties === true
        ? "allowed"
        : schema.additionalProperties === false
          ? "denied"
          : "schema"
  };
}

function summarizeTransport(tool = {}) {
  const transport = asObject(tool.transport);
  const rpc = asObject(tool.rpc);
  const openapi = asObject(tool.openapi);
  return {
    ...(transport.type ? { type: String(transport.type).trim() } : {}),
    ...(transport.method ? { method: String(transport.method).trim().toUpperCase() } : {}),
    ...(transport.path ? { path: String(transport.path).trim() } : {}),
    ...(transport.endpointRef ? { endpointRef: String(transport.endpointRef).trim() } : {}),
    ...(rpc.method ? { rpcMethod: String(rpc.method).trim() } : {}),
    ...(rpc.endpointRef ? { rpcEndpointRef: String(rpc.endpointRef).trim() } : {}),
    ...(openapi.operationId ? { openapiOperationId: String(openapi.operationId).trim() } : {}),
    endpointRedacted: Boolean(transport.url || transport.baseUrl)
  };
}

function summarizeExternalToolForReview(tool = {}) {
  return {
    name: String(tool.name || "").trim(),
    title: textPreview(tool.title || tool.label || tool.name),
    descriptionPreview: textPreview(tool.description || ""),
    fingerprint: externalToolFingerprint(tool),
    risk: String(tool.risk || "").trim(),
    readOnly: tool.readOnly === true,
    requiredScopes: uniqueStrings(tool.requiredScopes || []),
    inputSchema: summarizeInputSchema(tool.inputSchema || { type: "object" }),
    transport: summarizeTransport(tool)
  };
}

function reviewChangedFields(current = {}, previous = {}) {
  const checks = [
    ["title", textPreview(current.title || current.label || current.name), textPreview(previous.title || previous.label || previous.name)],
    ["description", textPreview(current.description || ""), textPreview(previous.description || "")],
    ["risk", String(current.risk || "").trim(), String(previous.risk || "").trim()],
    ["readOnly", current.readOnly === true, previous.readOnly === true],
    ["requiredScopes", JSON.stringify(uniqueStrings(current.requiredScopes || [])), JSON.stringify(uniqueStrings(previous.requiredScopes || []))],
    ["inputSchema", fingerprint(asObject(current.inputSchema)), fingerprint(asObject(previous.inputSchema))],
    ["transport", fingerprint({
      transport: current.transport,
      rpc: current.rpc,
      openapi: current.openapi
    }), fingerprint({
      transport: previous.transport,
      rpc: previous.rpc,
      openapi: previous.openapi
    })]
  ];
  return checks
    .filter(([, left, right]) => left !== right)
    .map(([field]) => field);
}

function toolRiskRank(tool = {}) {
  const risk = String(tool.risk || "").trim();
  return TOOL_RISK_RANK[risk] ?? (tool.readOnly === false ? TOOL_RISK_RANK.safe_write : TOOL_RISK_RANK.read_only);
}

function externalToolRiskFlags({ currentTool = {}, previousTool = null } = {}) {
  const flags = [];
  const text = [
    currentTool.name,
    currentTool.title,
    currentTool.label,
    currentTool.description,
    JSON.stringify(currentTool.annotations || {})
  ].map((value) => String(value || "")).join("\n");
  if (TOOL_PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(text))) {
    flags.push({
      code: "prompt_injection_like_description",
      severity: "high",
      message: "Tool metadata contains prompt-injection-like instructions and requires operator review before promotion."
    });
  }
  const currentRank = toolRiskRank(currentTool);
  const previousRank = previousTool ? toolRiskRank(previousTool) : TOOL_RISK_RANK.read_only;
  if (currentRank >= TOOL_RISK_RANK.safe_write && !previousTool) {
    flags.push({
      code: "new_write_capable_tool",
      severity: "high",
      message: "New write-capable external tool requires explicit risk acknowledgement before promotion."
    });
  }
  if (previousTool && currentRank > previousRank) {
    flags.push({
      code: "risk_level_increased",
      severity: "high",
      message: "External tool risk level increased and requires explicit acknowledgement before promotion."
    });
  }
  if (previousTool && previousTool.readOnly !== false && currentTool.readOnly === false) {
    flags.push({
      code: "read_only_downgraded",
      severity: "high",
      message: "External tool changed from read-only to write-capable."
    });
  }
  const schema = asObject(currentTool.inputSchema);
  const propertyCount = Object.keys(asObject(schema.properties)).length;
  const requiredCount = asArray(schema.required).length;
  if (schema.additionalProperties === true) {
    flags.push({
      code: "schema_allows_additional_properties",
      severity: "medium",
      message: "Input schema allows undeclared properties; outbound governance must constrain payload fields."
    });
  }
  if (propertyCount > TOOL_REVIEW_SCHEMA_PROPERTY_LIMIT || requiredCount > TOOL_REVIEW_SCHEMA_PROPERTY_LIMIT) {
    flags.push({
      code: "schema_too_broad_for_auto_promotion",
      severity: "medium",
      message: "Input schema is broad and should be reviewed before production promotion."
    });
  }
  return flags;
}

function schemaCanContainObjectValue(schema = {}) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return false;
  }
  const types = schemaTypeList(schema);
  const hasDirectObjectKeywords = Boolean(
    schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
  ) || Object.prototype.hasOwnProperty.call(schema, "additionalProperties");
  const hasPositiveComposition = ["allOf", "anyOf", "oneOf"].some((keyword) => jsonSchemaSubschemas(schema, keyword).length > 0);
  return types.includes("object") ||
    hasDirectObjectKeywords ||
    (!hasPositiveComposition && types.length === 0);
}

function collectOpenObjectSchemaPaths(schema = {}, pathText = "input", output = []) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return output;
  }
  if (schemaCanContainObjectValue(schema)) {
    if (schema.additionalProperties === undefined || schema.additionalProperties === true) {
      output.push(pathText);
    } else if (schema.additionalProperties && typeof schema.additionalProperties === "object" && !Array.isArray(schema.additionalProperties)) {
      collectOpenObjectSchemaPaths(schema.additionalProperties, `${pathText}.*`, output);
    }
    for (const [key, propertySchema] of Object.entries(asObject(schema.properties))) {
      collectOpenObjectSchemaPaths(propertySchema, `${pathText}.${key}`, output);
    }
  }
  if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
    collectOpenObjectSchemaPaths(schema.items, `${pathText}[]`, output);
  }
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    jsonSchemaSubschemas(schema, keyword).forEach((subschema, index) => {
      collectOpenObjectSchemaPaths(subschema, `${pathText}.${keyword}[${index}]`, output);
    });
  }
  return output;
}

function isModelGatewayTool(tool = {}) {
  return Boolean(tool?.modelGateway || tool?.annotations?.modelGateway);
}

function productionOpenInputSchemaPaths(tool = {}) {
  if (isModelGatewayTool(tool)) {
    return [];
  }
  return collectOpenObjectSchemaPaths(tool.inputSchema || { type: "object" });
}

function assertServiceHubProductionInputSchemaClosed(service = {}, tool = {}) {
  if (!serviceHubProductionEvidenceRequired(service)) {
    return;
  }
  const openSchemaPaths = productionOpenInputSchemaPaths(tool);
  if (!openSchemaPaths.length) {
    return;
  }
  const error = new Error(`ServiceHub production external tool input schema must deny undeclared properties: ${service.serviceId || "unknown"}/${tool?.name || "unknown"}`);
  error.code = "servicehub_candidate_input_schema_not_closed";
  error.statusCode = 409;
  error.serviceId = String(service.serviceId || "").trim();
  error.toolName = String(tool?.name || "").trim();
  error.openSchemaPaths = openSchemaPaths;
  throw error;
}

function externalToolReview({ currentTool = {}, previousTool = null, reasonCode = "" } = {}) {
  const current = summarizeExternalToolForReview(currentTool);
  const previous = previousTool ? summarizeExternalToolForReview(previousTool) : null;
  const changedFields = previous ? reviewChangedFields(currentTool, previousTool) : ["new_tool"];
  const riskFlags = externalToolRiskFlags({ currentTool, previousTool });
  const highRiskFlags = riskFlags.filter((flag) => flag.severity === "high");
  return {
    protocolVersion: SERVICEHUB_TOOL_REVIEW_PROTOCOL_VERSION,
    state: previous ? "changed" : "new",
    reasonCode: reasonCode || (previous ? "fingerprint_changed_requires_readoption" : "awaiting_operator_adoption"),
    current,
    previous,
    diff: {
      changedFields,
      currentFingerprint: current.fingerprint,
      previousFingerprint: previous?.fingerprint || ""
    },
    riskFlags,
    promotion: {
      blocked: highRiskFlags.length > 0,
      requiresAcknowledgement: highRiskFlags.length > 0,
      blockingFlagCodes: highRiskFlags.map((flag) => flag.code)
    }
  };
}

function normalizeAdoptionState(value = "") {
  const state = String(value || "").trim().toLowerCase();
  return ["candidate", "adopted", "active", "rejected", "disabled"].includes(state)
    ? state
    : "";
}

function toolAdoptionState(tool = {}, { legacyActive = false } = {}) {
  const explicit = normalizeAdoptionState(
    tool.adoption?.state ||
      tool.adoptionStatus ||
      tool.lifecycleState ||
      tool.status
  );
  if (explicit) {
    return explicit;
  }
  return legacyActive ? "active" : "candidate";
}

function isAdoptedExternalTool(tool = {}, options = {}) {
  return ["adopted", "active"].includes(toolAdoptionState(tool, options));
}

function isLegacyToolCacheShape(service = {}) {
  return !service.adoption &&
    service.activeToolCount === undefined &&
    asArray(service.tools).every((tool) =>
      !tool?.adoption && !tool?.adoptionStatus && !tool?.lifecycleState && !tool?.status
    );
}

function legacyToolCacheMigration(service = {}) {
  if (!isLegacyToolCacheShape(service)) {
    return null;
  }
  return {
    required: true,
    state: "requires_readoption",
    reasonCode: "legacy_cache_requires_tool_adoption",
    toolCount: asArray(service.tools).filter((tool) => String(tool?.name || "").trim()).length
  };
}

function legacyActiveToolCacheAllowed(service = {}) {
  return legacyToolCacheMigration(service) === null && isLegacyToolCacheShape(service);
}

function externalToolFingerprint(tool = {}) {
  return fingerprint({
    name: tool.name,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
    transport: tool.transport,
    request: tool.request,
    response: tool.response,
    rpc: tool.rpc,
    openapi: tool.openapi
  });
}

function candidateExternalTool(tool = {}, discoveredAt = "", {
  reasonCode = "awaiting_operator_adoption",
  previousFingerprint = "",
  previousTool = null
} = {}) {
  const review = externalToolReview({
    currentTool: tool,
    previousTool,
    reasonCode
  });
  return {
    ...tool,
    adoption: {
      protocolVersion: SERVICEHUB_TOOL_ADOPTION_PROTOCOL_VERSION,
      state: "candidate",
      discoveredAt: String(discoveredAt || nowIso()),
      fingerprint: externalToolFingerprint(tool),
      reasonCode,
      ...(previousFingerprint ? { previousFingerprint: String(previousFingerprint) } : {}),
      review
    }
  };
}

function adoptedExternalTool(tool = {}, {
  adoptedAt = nowIso(),
  adoptedBy = "operator",
  reasonCode = "operator_adopted_candidate"
} = {}) {
  const review = asObject(tool.adoption?.review, null) || externalToolReview({
    currentTool: tool,
    reasonCode
  });
  return {
    ...tool,
    adoption: {
      ...(tool.adoption || {}),
      protocolVersion: SERVICEHUB_TOOL_ADOPTION_PROTOCOL_VERSION,
      state: "adopted",
      adoptedAt,
      adoptedBy: String(adoptedBy || "operator").trim(),
      fingerprint: externalToolFingerprint(tool),
      reasonCode,
      review
    }
  };
}

function tombstoneExternalTool(tool = {}, {
  missingAt = nowIso(),
  previousFingerprint = "",
  discoveryFingerprint = "",
  existingTombstone = null
} = {}) {
  const name = String(tool?.name || "").trim();
  const fingerprintValue = String(previousFingerprint || tool?.adoption?.fingerprint || externalToolFingerprint(tool) || "").trim();
  return {
    protocolVersion: "v0.0.1:external-service:servicehub-tool-tombstone-1",
    state: "missing_upstream_requires_operator_review",
    name,
    title: textPreview(tool.title || tool.label || name),
    toolFingerprint: fingerprintValue,
    previousFingerprint: fingerprintValue,
    firstMissingAt: String(existingTombstone?.firstMissingAt || missingAt || nowIso()),
    lastMissingAt: String(missingAt || nowIso()),
    lastSeenAt: String(tool?.adoption?.adoptedAt || tool?.adoption?.discoveredAt || "").trim(),
    discoveryFingerprint: String(discoveryFingerprint || "").trim(),
    reasonCode: "active_tool_missing_from_upstream_discovery",
    review: externalToolReview({
      currentTool: tool,
      previousTool: tool,
      reasonCode: "active_tool_missing_from_upstream_discovery"
    })
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function publicServiceVersion(version = null) {
  if (!version || typeof version !== "object" || Array.isArray(version)) {
    return null;
  }
  return {
    protocolVersion: String(version.protocolVersion || SERVICEHUB_TOOL_VERSION_PROTOCOL_VERSION),
    state: String(version.state || ""),
    versionId: String(version.versionId || ""),
    baseVersionId: String(version.baseVersionId || ""),
    fingerprint: String(version.fingerprint || ""),
    serviceId: String(version.serviceId || ""),
    manifestId: String(version.manifestId || ""),
    manifestFingerprint: String(version.manifestFingerprint || ""),
    serviceFingerprint: String(version.serviceFingerprint || ""),
    toolCount: Number(version.toolCount || 0),
    toolNames: asArray(version.toolNames).map((name) => String(name || "").trim()).filter(Boolean).sort(),
    tombstoneCount: Number(version.tombstoneCount || 0),
    createdAt: String(version.createdAt || ""),
    createdBy: String(version.createdBy || ""),
    reasonCode: String(version.reasonCode || "")
  };
}

function serviceToolVersionSnapshot({
  service = {},
  tools = [],
  tombstones = [],
  state = "candidate",
  baseVersionId = "",
  createdAt = nowIso(),
  createdBy = "",
  reasonCode = "",
  existingVersion = null
} = {}) {
  const serviceId = String(service.serviceId || "").trim();
  const normalizedTools = asArray(tools)
    .filter((tool) => String(tool?.name || "").trim())
    .map((tool) => cloneJson(tool));
  const normalizedTombstones = asArray(tombstones).map((tombstone) => cloneJson(tombstone));
  const toolNames = normalizedTools.map((tool) => String(tool?.name || "").trim()).filter(Boolean).sort();
  const versionFingerprint = fingerprint({
    protocolVersion: SERVICEHUB_TOOL_VERSION_PROTOCOL_VERSION,
    serviceId,
    state,
    manifestId: service.manifestId || "",
    manifestFingerprint: service.manifestFingerprint || "",
    serviceFingerprint: service.fingerprint || "",
    tools: normalizedTools.map((tool) => ({
      name: tool.name,
      fingerprint: externalToolFingerprint(tool),
      adoptionFingerprint: String(tool?.adoption?.fingerprint || "").trim(),
      adoptionState: toolAdoptionState(tool),
      risk: String(tool.risk || "").trim(),
      requiredScopes: uniqueStrings(tool.requiredScopes || []),
      inputSchema: tool.inputSchema || { type: "object" },
      transport: summarizeTransport(tool)
    })),
    tombstones: normalizedTombstones.map((tombstone) => ({
      name: tombstone?.name,
      toolFingerprint: tombstone?.toolFingerprint,
      previousFingerprint: tombstone?.previousFingerprint,
      reasonCode: tombstone?.reasonCode
    }))
  });
  const versionId = `servicehub.version.${safeSegment(serviceId)}.${versionFingerprint.slice(0, 16)}`;
  if (
    existingVersion &&
    existingVersion.fingerprint === versionFingerprint &&
    existingVersion.versionId === versionId &&
    existingVersion.state === state
  ) {
    return {
      ...existingVersion,
      baseVersionId: String(baseVersionId || existingVersion.baseVersionId || "").trim(),
      tools: normalizedTools,
      toolNames,
      toolCount: normalizedTools.length,
      tombstones: normalizedTombstones,
      tombstoneCount: normalizedTombstones.length
    };
  }
  return {
    protocolVersion: SERVICEHUB_TOOL_VERSION_PROTOCOL_VERSION,
    state,
    versionId,
    baseVersionId: String(baseVersionId || "").trim(),
    fingerprint: versionFingerprint,
    serviceId,
    manifestId: String(service.manifestId || "").trim(),
    manifestFingerprint: String(service.manifestFingerprint || "").trim(),
    serviceFingerprint: String(service.fingerprint || "").trim(),
    tools: normalizedTools,
    toolNames,
    toolCount: normalizedTools.length,
    tombstones: normalizedTombstones,
    tombstoneCount: normalizedTombstones.length,
    createdAt: String(createdAt || nowIso()),
    createdBy: String(createdBy || "").trim(),
    reasonCode: String(reasonCode || "").trim()
  };
}

function uniqueRollbackVersions(versions = []) {
  const seen = new Set();
  const output = [];
  for (const version of asArray(versions)) {
    const id = String(version?.versionId || version?.fingerprint || "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    output.push(version);
    if (output.length >= MAX_ROLLBACK_VERSIONS) {
      break;
    }
  }
  return output;
}

function candidatePromotionBlocked(tool = {}) {
  const promotion = tool?.adoption?.review?.promotion;
  return promotion?.blocked === true || promotion?.requiresAcknowledgement === true;
}

function candidateBlockingFlagCodes(tool = {}) {
  return asArray(tool?.adoption?.review?.promotion?.blockingFlagCodes)
    .map((code) => String(code || "").trim())
    .filter(Boolean);
}

function externalToolReviewDetail(tool = {}, { legacyActive = false } = {}) {
  const adoption = asObject(tool.adoption, {});
  const state = toolAdoptionState(tool, { legacyActive });
  const review = asObject(adoption.review, null) || externalToolReview({
    currentTool: tool,
    reasonCode: adoption.reasonCode || (state === "candidate" ? "awaiting_operator_adoption" : "active_tool")
  });
  return {
    ...summarizeExternalToolForReview(tool),
    adoptionState: state,
    reasonCode: String(adoption.reasonCode || "").trim(),
    discoveredAt: String(adoption.discoveredAt || "").trim(),
    adoptedAt: String(adoption.adoptedAt || "").trim(),
    adoptedBy: String(adoption.adoptedBy || "").trim(),
    previousFingerprint: String(adoption.previousFingerprint || review.diff?.previousFingerprint || "").trim(),
    review
  };
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

function externalMcpCatalogChange({
  source = "external-mcp-passthrough-runtime",
  type = "external_service_catalog_refreshed",
  reasonCode = "",
  serviceId = "",
  serviceCatalogVersionId = "",
  activeVersionId = "",
  candidateVersionId = "",
  candidateFingerprint = "",
  manifestFingerprint = "",
  at = nowIso(),
  invalidation = null
} = {}) {
  const resolvedReason = String(reasonCode || type || "external_service_catalog_refreshed").trim();
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    source: String(source || "external-mcp-passthrough-runtime").trim(),
    type: String(type || resolvedReason).trim(),
    reasonCode: resolvedReason,
    serviceId: String(serviceId || "").trim(),
    serviceCatalogVersionId: String(serviceCatalogVersionId || activeVersionId || "").trim(),
    activeVersionId: String(activeVersionId || serviceCatalogVersionId || "").trim(),
    candidateVersionId: String(candidateVersionId || "").trim(),
    candidateFingerprint: String(candidateFingerprint || "").trim(),
    manifestFingerprint: String(manifestFingerprint || "").trim(),
    at: String(at || nowIso()).trim(),
    ...(invalidation ? { invalidation } : {})
  };
}

async function notifyExternalMcpCatalogChange(listener, catalogChange) {
  if (typeof listener !== "function") {
    return { notified: false, ok: true };
  }
  try {
    await listener(catalogChange);
    return { notified: true, ok: true };
  } catch (error) {
    return {
      notified: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
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

function externalResponseTooLargeError(label, maxBytes) {
  const error = new Error(`${label} exceeded the ${maxBytes} byte response limit.`);
  error.code = "external_response_too_large";
  error.maxBytes = maxBytes;
  return error;
}

function externalStreamingRejectedError(label = "External service streaming response") {
  const error = new Error(`${label} is not enabled for ServiceHub until streaming chunk governance is available.`);
  error.code = "external_streaming_rejected";
  error.statusCode = 422;
  return error;
}

async function cancelStreamingResponseWithEvidence(response, {
  label = "External service streaming response",
  reason = "streaming_response_rejected"
} = {}) {
  const evidence = {
    protocol: "sse",
    label,
    rejected: true,
    cleanup: {
      closeReason: reason,
      cancelCalled: false,
      cancelOk: null,
      cancelError: "",
      orphaned: Boolean(response?.body)
    }
  };
  if (response?.body?.cancel) {
    evidence.cleanup.cancelCalled = true;
    try {
      await response.body.cancel(reason);
      evidence.cleanup.cancelOk = true;
    } catch (error) {
      evidence.cleanup.cancelOk = false;
      evidence.cleanup.cancelError = error instanceof Error ? error.message : String(error || "cancel failed");
    }
  }
  return evidence;
}

async function readResponseTextWithLimit(response, {
  label = "External service response",
  maxBytes = MAX_EXTERNAL_SERVICE_RESPONSE_BYTES
} = {}) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try {
      await response.body?.cancel?.();
    } catch {
      // The caller only needs a bounded failure.
    }
    throw externalResponseTooLargeError(label, maxBytes);
  }
  if (!response.body?.getReader) {
    const text = typeof response.text === "function" ? await response.text() : "";
    if (Buffer.byteLength(text) > maxBytes) {
      throw externalResponseTooLargeError(label, maxBytes);
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size violation is the relevant failure.
        }
        throw externalResponseTooLargeError(label, maxBytes);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function isExternalMcpPassthroughConfig(config = {}) {
  return config?.upstream?.type === "mcp" && config?.binding?.mode === "passthrough";
}

export function isExternalHttpCompileConfig(config = {}) {
  const upstreamType = String(config?.upstream?.type || "").trim();
  const hasOpenApiSpec = Boolean(config?.upstream?.spec || config?.upstream?.specUrl || config?.upstream?.specFile);
  return config?.binding?.mode === "compile" &&
    HTTP_COMPILE_UPSTREAM_TYPES.has(upstreamType) &&
    (asArray(config?.tools).length > 0 || (upstreamType === "openapi" && hasOpenApiSpec) || upstreamType === "llm");
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
  if (config?.upstream?.type === "sse") {
    return normalizeSseTool(raw, config);
  }
  if (raw?.rpc || config?.upstream?.type === "rpc" || config?.upstream?.type === "json-rpc") {
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

function normalizeSseTool(raw = {}, config = {}) {
  const transport = asObject(raw.transport || raw.http || raw.request?.transport);
  const operationId = String(raw.operationId || raw.operation_id || raw.name || raw.toolId || raw.id || "").trim();
  const name = String(raw.name || operationId || raw.toolId || raw.id || "").trim();
  if (!name) {
    return null;
  }
  const request = asObject(raw.request);
  const response = asObject(raw.response);
  const sse = asObject(raw.sse);
  const maxEvents = Math.max(1, Number(
    sse.maxEvents ||
    sse.max_events ||
    response.maxEvents ||
    response.max_events ||
    raw.maxEvents ||
    raw.max_events ||
    1
  ) || 1);
  const maxBytes = Math.max(0, Number(
    sse.maxBytes ||
    sse.max_bytes ||
    response.maxBytes ||
    response.max_bytes ||
    raw.maxBytes ||
    raw.max_bytes ||
    0
  ) || 0);
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
      type: "sse",
      method: "GET",
      url: String(transport.url || raw.url || "").trim(),
      path: String(transport.path || raw.path || "").trim(),
      headers: asObject(transport.headers)
    },
    request: {
      query: request.query === undefined ? null : request.query,
      headers: asObject(request.headers),
      body: null
    },
    response: {
      resultPath: String(response.resultPath || response.result_path || "").trim(),
      maxEvents,
      ...(maxBytes > 0 ? { maxBytes } : {})
    },
    sse: {
      eventFormat: String(sse.eventFormat || sse.event_format || raw.eventFormat || config.upstream?.eventFormat || "json-data").trim(),
      eventTypes: uniqueStrings(raw.eventTypes || raw.event_types || sse.eventTypes || sse.event_types || transport.eventTypes || raw.transport?.eventTypes),
      maxEvents,
      ...(maxBytes > 0 ? { maxBytes } : {})
    },
    raw
  };
}

function modelGatewayToolName(protocol = "") {
  return String(protocol || "").trim() === "openai-responses"
    ? "responses_create"
    : "chat_completions_create";
}

function modelGatewayInputSchema(protocol = "") {
  if (String(protocol || "").trim() === "openai-responses") {
    return {
      type: "object",
      properties: {
        model: { type: "string" },
        input: {},
        instructions: { type: "string" },
        stream: { type: "boolean" },
        temperature: { type: "number" },
        max_output_tokens: { type: "integer" }
      },
      additionalProperties: true
    };
  }
  return {
    type: "object",
    properties: {
      model: { type: "string" },
      messages: {
        type: "array",
        items: { type: "object" }
      },
      stream: { type: "boolean" },
      temperature: { type: "number" },
      max_tokens: { type: "integer" }
    },
    additionalProperties: true
  };
}

function normalizeModelGatewayTool(raw = {}, config = {}) {
  const upstream = asObject(config.upstream);
  const protocol = String(upstream.modelProtocol || upstream.protocol || "openai-compatible").trim();
  if (!OPENAI_MODEL_PROTOCOLS.has(protocol)) {
    const error = new Error(`External model gateway protocol is not supported for runtime forwarding: ${protocol || "missing"}.`);
    error.code = "external_model_gateway_protocol_unsupported";
    throw error;
  }
  const transport = asObject(raw.transport || raw.http || raw.request?.transport);
  const response = asObject(raw.response);
  const binding = asObject(config.binding);
  const defaultName = modelGatewayToolName(protocol);
  const name = String(raw.name || raw.toolId || raw.id || defaultName).trim();
  if (!name) {
    return null;
  }
  const risk = String(raw.risk || binding.risk || "read_only").trim();
  return {
    name,
    title: String(raw.title || raw.label || (protocol === "openai-responses" ? "Create OpenAI response" : "Create chat completion")).trim(),
    description: String(raw.description || `Forward a bounded ${protocol} request through the ServiceHub model gateway.`).trim(),
    inputSchema: normalizeInputSchema(raw.inputSchema || raw.input_schema || raw.schema || modelGatewayInputSchema(protocol)),
    annotations: {
      modelGateway: true,
      modelProtocol: protocol,
      ...asObject(raw.annotations)
    },
    requiredScopes: uniqueStrings(raw.requiredScopes || raw.scopes || binding.requiredScopes || ["knowledge:read"]),
    risk,
    readOnly: raw.readOnly === undefined ? risk === "read_only" : raw.readOnly !== false,
    transport: {
      type: "http",
      method: "POST",
      url: String(transport.url || raw.url || upstream.url || "").trim(),
      path: String(transport.path || raw.path || "").trim(),
      headers: asObject(transport.headers)
    },
    request: {
      query: null,
      headers: asObject(raw.request?.headers),
      body: raw.request?.body === undefined ? "$input" : raw.request.body
    },
    response: {
      resultPath: String(response.resultPath || response.result_path || "").trim(),
      maxEvents: Number(response.maxEvents || response.max_events || 32)
    },
    modelGateway: {
      protocol,
      provider: String(upstream.provider || "").trim()
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
    ...(required.size ? { required: [...required] } : {}),
    additionalProperties: false
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

async function loadOpenApiSpec(config, { userDataPath = "" } = {}) {
  const upstream = asObject(config.upstream);
  if (upstream.spec && typeof upstream.spec === "object" && !Array.isArray(upstream.spec)) {
    return upstream.spec;
  }
  if (upstream.specUrl) {
    const { url } = parseExplicitHttpUrl(upstream.specUrl, "upstream.specUrl");
    const authHeaders = await resolveUpstreamAuthHeaders({
      upstream,
      userDataPath,
      serviceId: config.serviceId,
      url,
      requiredScopes: config.binding?.requiredScopes
    });
    let pinnedFetch = null;
    try {
      pinnedFetch = await fetchServiceHubRuntimeWithPinnedDns(config, url, "upstream.specUrl", {
        headers: trustedHeaderMap(authHeaders),
        redirect: "manual"
      });
      const { response } = pinnedFetch;
      const redirectDecision = isHttpRedirectStatus(response.status)
        ? await evaluateServiceHubRedirectDecision(config, {
            sourceUrl: url,
            status: response.status,
            location: response.headers.get("location") || "",
            label: "upstream.specUrl.redirectLocation"
          })
        : null;
      if (!response.ok) {
        const error = new Error(`External OpenAPI spec fetch failed with HTTP ${response.status}.`);
        error.statusCode = response.status;
        error.redirectDecision = redirectDecision;
        error.egressDecision = pinnedFetch.egressDecision;
        throw error;
      }
      const text = await readResponseTextWithLimit(response, { label: "External OpenAPI spec response" });
      return JSON.parse(text);
    } finally {
      await pinnedFetch?.close?.();
    }
  }
  if (upstream.specFile) {
    const specPath = path.isAbsolute(upstream.specFile)
      ? upstream.specFile
      : path.resolve(process.cwd(), upstream.specFile);
    return JSON.parse(await fsp.readFile(specPath, "utf8"));
  }
  return null;
}

async function compileOpenApiTools(config, { userDataPath = "" } = {}) {
  const spec = await loadOpenApiSpec(config, { userDataPath });
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

async function compileExternalHttpTools(config, { userDataPath = "" } = {}) {
  if (config?.upstream?.type === "openapi") {
    return compileOpenApiTools(config, { userDataPath });
  }
  if (config?.upstream?.type === "llm") {
    const configuredTools = asArray(config?.tools);
    return (configuredTools.length ? configuredTools : [{}])
      .map((tool) => normalizeModelGatewayTool(tool, config))
      .filter(Boolean);
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
  if (config?.upstream?.type === "llm") {
    return EXTERNAL_MODEL_GATEWAY_PROTOCOL_VERSION;
  }
  return config?.upstream?.type === "rpc" || config?.upstream?.type === "json-rpc"
    ? EXTERNAL_RPC_COMPILE_PROTOCOL_VERSION
    : EXTERNAL_HTTP_COMPILE_PROTOCOL_VERSION;
}

export async function discoverExternalHttpTools(config, { timeoutMs = DEFAULT_TIMEOUT_MS, userDataPath = "" } = {}) {
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
  await assertServiceHubRuntimeEgressAllowed(config, baseUrl, "upstream.url");
  const tools = await compileExternalHttpTools(config, { timeoutMs, userDataPath });
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
      baseUrl,
      ...upstreamRuntimeDescriptor(config.upstream, {})
    },
    binding: {
      mode: config.binding.mode,
      outlet: config.binding.outlet || "pact.serviceHub",
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
      schemaVersion: String(raw.schemaVersion || "v0.0.1:schema:definition-1"),
      kind: raw.kind || EXTERNAL_MCP_CACHE_KIND,
      updatedAt: String(raw.updatedAt || "").trim(),
      services: asObject(raw.services)
    };
  } catch {
    return {
      schemaVersion: "v0.0.1:schema:definition-1",
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

function normalizeGenericSseEvent(event = {}) {
  const dataText = String(event.data || "");
  let data = dataText;
  try {
    data = dataText ? JSON.parse(dataText) : "";
  } catch {
    data = dataText;
  }
  return {
    ...(event.id ? { id: event.id } : {}),
    ...(event.event ? { event: event.event } : {}),
    data
  };
}

function parseSseEventBlock(block = "") {
  const current = {
    event: "",
    id: "",
    data: []
  };
  for (const line of String(block || "").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith(":")) {
      continue;
    }
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? "" : line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "event") {
      current.event = value;
    } else if (field === "id") {
      current.id = value;
    } else if (field === "data") {
      current.data.push(value);
    }
  }
  if (!current.data.length && !current.event && !current.id) {
    return null;
  }
  return {
    event: current.event || "message",
    id: current.id,
    data: current.data.join("\n")
  };
}

function createIncrementalSseParser({
  label = "External MCP SSE response",
  maxBytes = MAX_EXTERNAL_SERVICE_RESPONSE_BYTES,
  onBytesRead = null
} = {}) {
  let buffer = "";
  let totalBytes = 0;
  function consume(text = "", { final = false } = {}) {
    const chunk = String(text || "");
    totalBytes += Buffer.byteLength(chunk);
    onBytesRead?.(totalBytes);
    if (totalBytes > maxBytes) {
      throw externalResponseTooLargeError(label, maxBytes);
    }
    buffer += chunk;
    const events = [];
    while (true) {
      const match = buffer.match(/\r?\n\r?\n/);
      if (!match) {
        break;
      }
      const index = match.index ?? -1;
      const separatorLength = match[0].length;
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + separatorLength);
      const event = parseSseEventBlock(block);
      if (event) {
        events.push(event);
      }
    }
    if (final && buffer.trim()) {
      const event = parseSseEventBlock(buffer);
      buffer = "";
      if (event) {
        events.push(event);
      }
    }
    return events;
  }
  return {
    consume,
    getBytesRead: () => totalBytes
  };
}

function createSseReaderEvidenceSnapshot({
  evidence,
  outputMaxEvents = null,
  outputEvents = null,
  truncated = false
} = {}) {
  return {
    protocol: "sse",
    label: evidence.label,
    byteBudget: {
      maxBytes: evidence.byteBudget.maxBytes,
      bytesRead: evidence.byteBudget.bytesRead,
      exceeded: evidence.byteBudget.exceeded
    },
    eventBudget: {
      maxEvents: evidence.eventBudget.maxEvents,
      eventsRead: evidence.eventBudget.eventsRead,
      exceeded: evidence.eventBudget.exceeded,
      readWindowMaxEvents: evidence.eventBudget.readWindowMaxEvents,
      ...(outputMaxEvents !== null ? { outputMaxEvents } : {}),
      ...(outputEvents !== null ? { outputEvents } : {}),
      truncated: Boolean(truncated || evidence.eventBudget.truncated)
    },
    cleanup: {
      closed: evidence.cleanup.closed,
      closeReason: evidence.cleanup.closeReason,
      failedClosed: evidence.cleanup.failedClosed,
      cancelCalled: evidence.cleanup.cancelCalled,
      cancelOk: evidence.cleanup.cancelOk,
      cancelError: evidence.cleanup.cancelError,
      releaseCalled: evidence.cleanup.releaseCalled,
      releaseOk: evidence.cleanup.releaseOk,
      releaseError: evidence.cleanup.releaseError,
      orphaned: evidence.cleanup.orphaned,
      signalAborted: evidence.cleanup.signalAborted
    }
  };
}

function externalSseEventLimitError(label, maxEvents) {
  const error = new Error(`${label} exceeded the ${maxEvents} event read limit.`);
  error.code = "external_mcp_sse_event_limit_exceeded";
  error.maxEvents = maxEvents;
  return error;
}

async function createSseEventReader(response, {
  label = "External MCP SSE response",
  maxBytes = MAX_EXTERNAL_SERVICE_RESPONSE_BYTES,
  maxEvents = MAX_MCP_SSE_EVENTS_PER_REQUEST,
  signal = undefined
} = {}) {
  const byteLimit = Math.max(1, Number(maxBytes || MAX_EXTERNAL_SERVICE_RESPONSE_BYTES));
  const eventLimit = Math.max(1, Number(maxEvents || MAX_MCP_SSE_EVENTS_PER_REQUEST));
  const evidence = {
    label,
    byteBudget: {
      maxBytes: byteLimit,
      bytesRead: 0,
      exceeded: false
    },
    eventBudget: {
      maxEvents: eventLimit,
      eventsRead: 0,
      exceeded: false,
      readWindowMaxEvents: eventLimit,
      truncated: false
    },
    cleanup: {
      closed: false,
      closeReason: "",
      failedClosed: false,
      cancelCalled: false,
      cancelOk: null,
      cancelError: "",
      releaseCalled: false,
      releaseOk: null,
      releaseError: "",
      orphaned: false,
      signalAborted: false
    }
  };
  const parser = createIncrementalSseParser({
    label,
    maxBytes: byteLimit,
    onBytesRead(bytesRead) {
      evidence.byteBudget.bytesRead = bytesRead;
    }
  });
  const queue = [];
  let done = false;
  let streamDone = false;
  const reader = response.body?.getReader ? response.body.getReader() : null;
  let closePromise = null;
  const snapshot = (options = {}) => createSseReaderEvidenceSnapshot({ evidence, ...options });
  const close = async ({
    reason = "reader_closed",
    truncated = false,
    failedClosed = false
  } = {}) => {
    if (closePromise) {
      return closePromise;
    }
    closePromise = (async () => {
      done = true;
      signal?.removeEventListener?.("abort", abortReader);
      evidence.cleanup.closed = true;
      evidence.cleanup.closeReason = reason;
      evidence.cleanup.failedClosed = Boolean(failedClosed);
      evidence.eventBudget.truncated = Boolean(truncated || evidence.eventBudget.truncated);
      evidence.cleanup.orphaned = Boolean(reader && !streamDone);
      if (reader?.cancel) {
        evidence.cleanup.cancelCalled = true;
        try {
          await reader.cancel(reason);
          evidence.cleanup.cancelOk = true;
        } catch (error) {
          evidence.cleanup.cancelOk = false;
          evidence.cleanup.cancelError = error instanceof Error ? error.message : String(error || "cancel failed");
        }
      }
      if (reader?.releaseLock) {
        evidence.cleanup.releaseCalled = true;
        try {
          reader.releaseLock();
          evidence.cleanup.releaseOk = true;
        } catch (error) {
          evidence.cleanup.releaseOk = false;
          evidence.cleanup.releaseError = error instanceof Error ? error.message : String(error || "release failed");
        }
      }
      return snapshot();
    })();
    return closePromise;
  };
  const abortReader = () => {
    evidence.cleanup.signalAborted = true;
    void close({
      reason: "signal_aborted",
      failedClosed: true
    });
  };
  signal?.addEventListener?.("abort", abortReader, { once: true });
  if (!reader) {
    try {
      const text = typeof response.text === "function" ? await response.text() : "";
      queue.push(...parser.consume(text, { final: true }));
      done = true;
      streamDone = true;
    } catch (error) {
      if (error?.code === "external_response_too_large") {
        evidence.byteBudget.exceeded = true;
      }
      error.streamEvidence = snapshot({ truncated: true });
      throw error;
    }
  }
  async function readAny() {
    while (queue.length === 0 && !done) {
      const next = await reader.read();
      if (next.done) {
        queue.push(...parser.consume("", { final: true }));
        done = true;
        streamDone = true;
        break;
      }
      if (next.value) {
        queue.push(...parser.consume(Buffer.from(next.value).toString("utf8")));
      }
    }
    return queue.shift() || null;
  }
  return {
    async readNext({
      eventTypes = [],
      maxEvents = MAX_MCP_SSE_EVENTS_PER_REQUEST
    } = {}) {
      const allowed = new Set(asArray(eventTypes).map((event) => String(event || "").trim()).filter(Boolean));
      const readWindowMaxEvents = Math.max(1, Number(maxEvents || eventLimit));
      evidence.eventBudget.readWindowMaxEvents = readWindowMaxEvents;
      let observed = 0;
      try {
        while (observed < readWindowMaxEvents) {
          if (evidence.eventBudget.eventsRead >= eventLimit) {
            evidence.eventBudget.exceeded = true;
            throw externalSseEventLimitError(label, eventLimit);
          }
          const event = await readAny();
          if (!event) {
            return null;
          }
          observed += 1;
          evidence.eventBudget.eventsRead += 1;
          if (allowed.size === 0 || allowed.has(event.event || "message")) {
            return event;
          }
        }
        evidence.eventBudget.exceeded = true;
        throw externalSseEventLimitError(label, readWindowMaxEvents);
      } catch (error) {
        if (error?.code === "external_response_too_large") {
          evidence.byteBudget.exceeded = true;
        }
        if (error?.code === "external_mcp_sse_event_limit_exceeded") {
          evidence.eventBudget.exceeded = true;
        }
        error.streamEvidence = await close({
          reason: error?.code || "reader_error",
          truncated: true,
          failedClosed: true
        });
        throw error;
      }
    },
    close,
    getEvidence: snapshot
  };
}

async function readGenericSseEventsWithLimit(response, {
  label = "External HTTP SSE response",
  maxBytes = MAX_EXTERNAL_SERVICE_RESPONSE_BYTES,
  maxEvents = 1,
  eventTypes = [],
  signal = undefined
} = {}) {
  const outputEventLimit = Math.max(1, Number(maxEvents || 1));
  const readEventBudget = Math.max(outputEventLimit, MAX_MCP_SSE_EVENTS_PER_REQUEST);
  const reader = await createSseEventReader(response, {
    label,
    maxBytes,
    maxEvents: readEventBudget,
    signal
  });
  const events = [];
  let closeEvidence = null;
  try {
    while (events.length < outputEventLimit) {
      const event = await reader.readNext({
        eventTypes,
        maxEvents: readEventBudget
      });
      if (!event) {
        break;
      }
      events.push(normalizeGenericSseEvent(event));
    }
  } finally {
    closeEvidence = await reader.close({
      reason: events.length >= outputEventLimit ? "event_output_limit_reached" : "reader_exhausted",
      truncated: events.length >= outputEventLimit
    });
  }
  return {
    events,
    streamEvidence: createSseReaderEvidenceSnapshot({
      evidence: {
        label: closeEvidence.label,
        byteBudget: closeEvidence.byteBudget,
        eventBudget: closeEvidence.eventBudget,
        cleanup: closeEvidence.cleanup
      },
      outputMaxEvents: outputEventLimit,
      outputEvents: events.length,
      truncated: events.length >= outputEventLimit
    })
  };
}

function legacySseEndpointUrlFromEvent(event = {}, baseUrl = "") {
  const rawText = String(event.data || "").trim();
  if (!rawText) {
    throw new Error("External MCP SSE endpoint event did not include a message endpoint URI.");
  }
  let endpointText = rawText;
  try {
    const parsed = JSON.parse(rawText);
    if (typeof parsed === "string") {
      endpointText = parsed;
    } else if (parsed && typeof parsed === "object") {
      endpointText = String(parsed.endpoint || parsed.url || parsed.uri || "").trim();
    }
  } catch {
    // The legacy MCP SSE endpoint event normally carries the URI as plain text.
  }
  if (!endpointText) {
    throw new Error("External MCP SSE endpoint event did not include a usable message endpoint URI.");
  }
  return new URL(endpointText, baseUrl).toString();
}

function parseJsonRpcEventPayload(event = {}) {
  if (!String(event?.data || "").trim()) {
    return null;
  }
  const parsed = JSON.parse(event.data);
  return parsed && typeof parsed === "object" ? parsed : null;
}

async function parseOptionalJsonRpcHttpResponse(response, {
  label = "External MCP response"
} = {}) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const contentLength = String(response.headers.get("content-length") || "").trim();
  if (!contentType && contentLength === "0") {
    return null;
  }
  const text = await readResponseTextWithLimit(response, { label });
  if (!text.trim()) {
    return null;
  }
  if (contentType.includes("text/event-stream")) {
    return parseSseJsonPayload(text);
  }
  return JSON.parse(text);
}

async function parseJsonRpcHttpResponse(response) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const text = await readResponseTextWithLimit(response, { label: "External MCP response" });
  if (!text.trim()) {
    return null;
  }
  if (contentType.includes("text/event-stream")) {
    return parseSseJsonPayload(text);
  }
  return JSON.parse(text);
}

async function postJsonRpc({
  url,
  message,
  sessionId = "",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  headers = {},
  egressSource = null,
  egressLabel = "upstream.url",
  signal = undefined
}) {
  const controller = new AbortController();
  const abortSignals = combineAbortSignals([controller.signal, signal]);
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs || DEFAULT_TIMEOUT_MS)));
  let pinnedFetch = null;
  try {
    pinnedFetch = await fetchServiceHubRuntimeWithPinnedDns(egressSource || {}, url, egressLabel, {
      method: "POST",
      headers: {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        ...trustedHeaderMap(headers),
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {})
      },
      body: JSON.stringify(message),
      redirect: "manual",
      signal: abortSignals.signal
    });
    const { response, egressDecision } = pinnedFetch;
    const nextSessionId = response.headers.get("mcp-session-id") || sessionId || "";
    const redirectDecision = isHttpRedirectStatus(response.status)
      ? await evaluateServiceHubRedirectDecision(egressSource || {}, {
          sourceUrl: url,
          status: response.status,
          location: response.headers.get("location") || "",
          label: `${egressLabel}.redirectLocation`
        })
      : null;
    const body = isHttpRedirectStatus(response.status) ? null : await parseJsonRpcHttpResponse(response);
    if (!response.ok) {
      const error = new Error(`External MCP HTTP ${response.status} for ${message.method}.`);
      error.statusCode = response.status;
      error.payload = body;
      error.redirectDecision = redirectDecision;
      error.egressDecision = egressDecision;
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
      result: body?.result,
      egressDecision
    };
  } finally {
    await pinnedFetch?.close?.();
    clearTimeout(timeout);
    abortSignals.cleanup();
  }
}

async function postLegacySseJsonRpc({
  postUrl,
  message,
  eventReader,
  expectResponse = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  headers = {},
  egressSource = null,
  egressLabel = "upstream.sse.messageEndpoint",
  signal = undefined
}) {
  const pinnedFetch = await fetchServiceHubRuntimeWithPinnedDns(egressSource || {}, postUrl, egressLabel, {
    method: "POST",
    headers: {
      "Accept": "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...trustedHeaderMap(headers)
    },
    body: JSON.stringify(message),
    redirect: "manual",
    signal
  });
  const { response, egressDecision } = pinnedFetch;
  let redirectDecision = null;
  let body = null;
  try {
    redirectDecision = isHttpRedirectStatus(response.status)
      ? await evaluateServiceHubRedirectDecision(egressSource || {}, {
          sourceUrl: postUrl,
          status: response.status,
          location: response.headers.get("location") || "",
          label: `${egressLabel}.redirectLocation`
        })
      : null;
    body = isHttpRedirectStatus(response.status)
      ? null
      : await parseOptionalJsonRpcHttpResponse(response, { label: "External MCP SSE POST response" });
  } finally {
    await pinnedFetch.close?.();
  }
  if (!response.ok) {
    const error = new Error(`External MCP SSE HTTP ${response.status} for ${message.method}.`);
    error.statusCode = response.status;
    error.payload = body;
    error.redirectDecision = redirectDecision;
    error.egressDecision = egressDecision;
    throw error;
  }
  if (body?.error) {
    const error = new Error(body.error.message || `External MCP SSE JSON-RPC error for ${message.method}.`);
    error.code = body.error.code;
    error.payload = body.error;
    throw error;
  }
  if (!expectResponse || message.id === null || message.id === undefined) {
    return {
      body,
      result: body?.result,
      egressDecision
    };
  }
  if (body && String(body.id || "") === String(message.id || "")) {
    return {
      body,
      result: body.result,
      egressDecision
    };
  }
  const startedAtMs = Date.now();
  while (Date.now() - startedAtMs < Math.max(1, Number(timeoutMs || DEFAULT_TIMEOUT_MS))) {
    const event = await eventReader.readNext({
      eventTypes: ["message"],
      maxEvents: MAX_MCP_SSE_EVENTS_PER_REQUEST
    });
    if (!event) {
      break;
    }
    const payload = parseJsonRpcEventPayload(event);
    if (!payload || String(payload.id || "") !== String(message.id || "")) {
      continue;
    }
    if (payload.error) {
      const error = new Error(payload.error.message || `External MCP SSE JSON-RPC error for ${message.method}.`);
      error.code = payload.error.code;
      error.payload = payload.error;
      throw error;
    }
    return {
      body: payload,
      result: payload.result,
      egressDecision
    };
  }
  const error = new Error(`External MCP SSE response timed out for ${message.method}.`);
  error.code = "external_mcp_sse_response_timeout";
  error.streamEvidence = eventReader.getEvidence?.();
  throw error;
}

async function initializeExternalMcpSseSession({ config, timeoutMs = DEFAULT_TIMEOUT_MS, signal = undefined }) {
  const upstream = config.upstream || {};
  const { url } = parseExplicitHttpUrl(upstream.url, "upstream.url");
  const authHeaders = await resolveUpstreamAuthHeaders({
    upstream,
    userDataPath: config.userDataPath,
    serviceId: config.serviceId,
    url,
    requiredScopes: config.binding?.requiredScopes,
    tenantId: config.tenantId,
    workspaceId: config.workspaceId,
    authBindingId: config.authBindingId
  });
  const controller = new AbortController();
  const abortSignals = combineAbortSignals([controller.signal, signal]);
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs || DEFAULT_TIMEOUT_MS)));
  let eventReader = null;
  let endpointFetch = null;
  try {
    endpointFetch = await fetchServiceHubRuntimeWithPinnedDns(config, url, "upstream.url", {
      method: "GET",
      headers: {
        "Accept": "text/event-stream",
        ...trustedHeaderMap(authHeaders)
      },
      redirect: "manual",
      signal: abortSignals.signal
    });
    const { response, egressDecision } = endpointFetch;
    const redirectDecision = isHttpRedirectStatus(response.status)
      ? await evaluateServiceHubRedirectDecision(config, {
          sourceUrl: url,
          status: response.status,
          location: response.headers.get("location") || "",
          label: "upstream.url.redirectLocation"
        })
      : null;
    if (!response.ok) {
      const error = new Error(`External MCP SSE HTTP ${response.status} while opening endpoint stream.`);
      error.statusCode = response.status;
      error.redirectDecision = redirectDecision;
      error.egressDecision = egressDecision;
      throw error;
    }
    eventReader = await createSseEventReader(response, {
      label: "External MCP SSE endpoint stream",
      maxBytes: MAX_EXTERNAL_SERVICE_RESPONSE_BYTES,
      maxEvents: MAX_MCP_SSE_EVENTS_PER_REQUEST,
      signal: abortSignals.signal
    });
    const endpointEvent = await eventReader.readNext({
      eventTypes: ["endpoint"],
      maxEvents: 16
    });
    if (!endpointEvent) {
      const error = new Error("External MCP SSE endpoint stream did not provide an endpoint event.");
      error.code = "external_mcp_sse_endpoint_missing";
      throw error;
    }
    const postUrl = legacySseEndpointUrlFromEvent(endpointEvent, url);
    parseExplicitHttpUrl(postUrl, "upstream.sse.messageEndpoint");
    const messageEndpointEgressDecision = await assertServiceHubRuntimeEgressAllowed(config, postUrl, "upstream.sse.messageEndpoint");
    const messageAuthHeaders = await resolveUpstreamAuthHeaders({
      upstream,
      userDataPath: config.userDataPath,
      serviceId: config.serviceId,
      url: postUrl,
      requiredScopes: config.binding?.requiredScopes,
      tenantId: config.tenantId,
      workspaceId: config.workspaceId,
      authBindingId: config.authBindingId
    });
    const postMessage = (message, { expectResponse = true } = {}) => postLegacySseJsonRpc({
      postUrl,
      message,
      eventReader,
      expectResponse,
      timeoutMs,
      headers: messageAuthHeaders,
      egressSource: config,
      egressLabel: "upstream.sse.messageEndpoint",
      signal: abortSignals.signal
    });
    const initialized = await postMessage(jsonRpcMessage("initialize", {
      protocolVersion: MCP_LEGACY_SSE_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "pact-external-mcp-passthrough",
        version: "0.0.1"
      }
    }, "pact-init"));
    await postMessage(jsonRpcMessage("notifications/initialized", {}, null), {
      expectResponse: false
    }).catch(() => null);
    return {
      transport: "sse",
      url,
      postUrl,
      authHeaders,
      egressDecision,
      messageEndpointEgressDecision,
      initializeResult: initialized.result || {},
      postJsonRpc: ({ message, expectResponse = true } = {}) => postMessage(message, { expectResponse }),
      close: async ({ reason = "mcp_sse_session_closed", failedClosed = false } = {}) => {
        clearTimeout(timeout);
        abortSignals.cleanup();
        const streamEvidence = await eventReader?.close?.({
          reason,
          failedClosed
        });
        await endpointFetch?.close?.();
        return streamEvidence
          ? {
              ...streamEvidence,
              transport: "sse",
              endpointUrl: url,
              messageEndpointUrl: postUrl
            }
          : null;
      }
    };
  } catch (error) {
    clearTimeout(timeout);
    abortSignals.cleanup();
    const streamEvidence = await eventReader?.close?.({
      reason: error?.code || "mcp_sse_session_open_failed",
      failedClosed: true
    });
    if (streamEvidence && !error.streamEvidence) {
      error.streamEvidence = streamEvidence;
    }
    await endpointFetch?.close?.();
    throw error;
  }
}

async function initializeExternalMcpStreamableHttpSession({ config, timeoutMs = DEFAULT_TIMEOUT_MS, signal = undefined }) {
  const upstream = config.upstream || {};
  const { url } = parseExplicitHttpUrl(upstream.url, "upstream.url");
  const authHeaders = await resolveUpstreamAuthHeaders({
    upstream,
    userDataPath: config.userDataPath,
    serviceId: config.serviceId,
    url,
    requiredScopes: config.binding?.requiredScopes,
    tenantId: config.tenantId,
    workspaceId: config.workspaceId,
    authBindingId: config.authBindingId
  });
  const initialized = await postJsonRpc({
    url,
    timeoutMs,
    headers: authHeaders,
    egressSource: config,
    egressLabel: "upstream.url",
    signal,
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
      headers: authHeaders,
      egressSource: config,
      egressLabel: "upstream.url",
      signal,
      message: jsonRpcMessage("notifications/initialized", {}, null)
    }).catch(() => null);
  }
  return {
    transport: "streamable-http",
    url,
    sessionId: initialized.sessionId,
    authHeaders,
    egressDecision: initialized.egressDecision,
    initializeResult: initialized.result || {},
    postJsonRpc: ({ message } = {}) => postJsonRpc({
      url,
      sessionId: initialized.sessionId,
      timeoutMs,
      headers: authHeaders,
      egressSource: config,
      egressLabel: "upstream.url",
      signal,
      message
    }),
    close: async () => {}
  };
}

async function initializeExternalMcpSession({ config, timeoutMs = DEFAULT_TIMEOUT_MS, signal = undefined }) {
  const transport = String(config?.upstream?.transport || "streamable-http").trim();
  if (!RAW_MCP_RUNTIME_TRANSPORTS.has(transport)) {
    const error = new Error(`External MCP transport is not supported by ServiceHub runtime: ${transport || "missing"}.`);
    error.code = "external_mcp_transport_not_allowed";
    error.statusCode = 400;
    error.transport = transport;
    throw error;
  }
  if (transport === "sse") {
    return initializeExternalMcpSseSession({ config, timeoutMs, signal });
  }
  return initializeExternalMcpStreamableHttpSession({ config, timeoutMs, signal });
}

export async function discoverExternalMcpTools(config, { timeoutMs = DEFAULT_TIMEOUT_MS, userDataPath = "" } = {}) {
  if (!isExternalMcpPassthroughConfig(config)) {
    return {
      ok: false,
      serviceId: config?.serviceId || "",
      tools: [],
      error: "Config is not an MCP passthrough external service."
    };
  }
  const session = await initializeExternalMcpSession({
    config: {
      ...config,
      userDataPath
    },
    timeoutMs
  });
  try {
    const listed = await session.postJsonRpc({
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
        url: session.url,
        ...(session.postUrl ? { messageEndpointUrl: session.postUrl } : {}),
        ...upstreamRuntimeDescriptor(config.upstream, {})
      },
      binding: {
        mode: config.binding.mode,
        outlet: config.binding.outlet || "pact.serviceHub"
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
  } finally {
    await session.close?.();
  }
}

export async function refreshExternalMcpToolCache({
  userDataPath = "",
  config,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  discovery: providedDiscovery = null,
  manifestId = "",
  manifestFingerprint = "",
  productionGates = [],
  productionGateEvidence = null,
  catalogChangeListener = null,
  changeListener = null,
  catalogChangeSource = "external-mcp-passthrough-runtime"
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
      ? await discoverExternalMcpTools(config, { timeoutMs, userDataPath })
      : await discoverExternalHttpTools(config, { timeoutMs, userDataPath }));
  const cache = readCacheFileSync(userDataPath);
  const existingService = cache.services?.[config.serviceId] || {};
  const existingLegacyActive = legacyActiveToolCacheAllowed(existingService);
  const existingActiveTools = asArray(existingService.tools)
    .filter((tool) => isAdoptedExternalTool(tool, { legacyActive: existingLegacyActive }));
  const existingTombstonesByName = new Map(
    asArray(existingService.tombstones)
      .map((tombstone) => [String(tombstone?.name || "").trim(), tombstone])
      .filter(([name]) => Boolean(name))
  );
  const discoveredByName = new Map(
    discovery.tools
      .map((tool) => [String(tool?.name || "").trim(), tool])
      .filter(([name]) => Boolean(name))
  );
  const activeTools = [];
  const staleActiveByName = new Map();
  const unchangedActiveNames = new Set();
  const missingActiveTools = [];
  for (const tool of existingActiveTools) {
    const name = String(tool?.name || "").trim();
    const discoveredTool = discoveredByName.get(name);
    const previousFingerprint = String(tool?.adoption?.fingerprint || externalToolFingerprint(tool) || "").trim();
    const nextFingerprint = discoveredTool ? externalToolFingerprint(discoveredTool) : "";
    if (discoveredTool && previousFingerprint && previousFingerprint === nextFingerprint) {
      activeTools.push(tool);
      unchangedActiveNames.add(name);
      continue;
    }
    activeTools.push(tool);
    if (name) {
      staleActiveByName.set(name, {
        tool,
        previousFingerprint,
        missing: !discoveredTool
      });
      if (!discoveredTool) {
        missingActiveTools.push({ tool, previousFingerprint });
      }
    }
  }
  const candidateTools = discovery.tools
    .filter((tool) => !unchangedActiveNames.has(String(tool?.name || "").trim()))
    .map((tool) => {
      const name = String(tool?.name || "").trim();
      const stale = staleActiveByName.get(name);
      return candidateExternalTool(tool, discovery.discoveredAt, stale
        ? {
            reasonCode: "fingerprint_changed_requires_readoption",
            previousFingerprint: stale.previousFingerprint,
            previousTool: stale.tool
          }
        : {});
    });
  const currentNames = new Set(discovery.tools.map((tool) => String(tool?.name || "").trim()).filter(Boolean));
  const missingActiveNames = new Set(missingActiveTools.map(({ tool }) => String(tool?.name || "").trim()).filter(Boolean));
  const tombstones = [
    ...asArray(existingService.tombstones).filter((tombstone) =>
      !currentNames.has(String(tombstone?.name || "").trim()) &&
      !missingActiveNames.has(String(tombstone?.name || "").trim())
    ),
    ...missingActiveTools.map(({ tool, previousFingerprint }) => tombstoneExternalTool(tool, {
      missingAt: discovery.discoveredAt,
      previousFingerprint,
      discoveryFingerprint: discovery.fingerprint,
      existingTombstone: existingTombstonesByName.get(String(tool?.name || "").trim())
    }))
  ];
  const allTools = [...activeTools, ...candidateTools];
  const resolvedManifestId = String(manifestId || config?.manifestId || existingService.manifestId || "").trim();
  const resolvedManifestFingerprint = String(
    manifestFingerprint || config?.manifestFingerprint || existingService.manifestFingerprint || ""
  ).trim();
  const resolvedProductionGates = Array.isArray(productionGates) && productionGates.length
    ? productionGates
    : Array.isArray(config?.productionGates)
      ? config.productionGates
      : Array.isArray(config?.evidence?.productionGates)
        ? config.evidence.productionGates
        : Array.isArray(existingService.productionGates)
          ? existingService.productionGates
          : [];
  const resolvedProductionGateEvidence = productionGateEvidence && typeof productionGateEvidence === "object" && !Array.isArray(productionGateEvidence)
    ? productionGateEvidence
    : config?.productionGateEvidence && typeof config.productionGateEvidence === "object" && !Array.isArray(config.productionGateEvidence)
      ? config.productionGateEvidence
      : existingService.productionGateEvidence && typeof existingService.productionGateEvidence === "object" && !Array.isArray(existingService.productionGateEvidence)
        ? existingService.productionGateEvidence
        : null;
  const serviceVersionSource = {
    serviceId: config.serviceId,
    manifestId: resolvedManifestId,
    manifestFingerprint: resolvedManifestFingerprint,
    fingerprint: discovery.fingerprint
  };
  const activeVersion = serviceToolVersionSnapshot({
    service: serviceVersionSource,
    tools: activeTools,
    tombstones,
    state: "active",
    createdAt: String(existingService.activeVersion?.createdAt || discovery.discoveredAt || nowIso()),
    reasonCode: activeTools.length ? "active_catalog_preserved_on_refresh" : "no_active_tools",
    existingVersion: existingService.activeVersion
  });
  const candidateVersion = serviceToolVersionSnapshot({
    service: serviceVersionSource,
    tools: candidateTools,
    tombstones,
    state: "candidate",
    baseVersionId: activeVersion.versionId,
    createdAt: discovery.discoveredAt || nowIso(),
    reasonCode: "refresh_creates_candidate_catalog",
    existingVersion: existingService.candidateVersion
  });
  const nextCache = {
    schemaVersion: "v0.0.1:schema:definition-1",
    kind: EXTERNAL_MCP_CACHE_KIND,
    updatedAt: nowIso(),
    services: {
      ...cache.services,
      [config.serviceId]: {
        serviceId: config.serviceId,
        serviceName: config.serviceName || config.serviceId,
        displayName: config.displayName || config.serviceId,
        policyPreset: config.policyPreset || "",
        policies: asObject(config.policies),
        manifestId: resolvedManifestId,
        manifestFingerprint: resolvedManifestFingerprint,
        ...(resolvedProductionGates.length ? { productionGates: resolvedProductionGates } : {}),
        ...(resolvedProductionGateEvidence ? { productionGateEvidence: resolvedProductionGateEvidence } : {}),
        ...(existingService.productionEvidenceCandidateFingerprint
          ? { productionEvidenceCandidateFingerprint: String(existingService.productionEvidenceCandidateFingerprint || "").trim() }
          : {}),
        serviceCatalogVersionId: activeVersion.versionId,
        activeVersionId: activeVersion.versionId,
        activeVersion,
        candidateVersion,
        rollbackVersions: uniqueRollbackVersions(existingService.rollbackVersions),
        upstream: upstreamRuntimeDescriptor(config.upstream, discovery.upstream),
        binding: discovery.binding,
        adoption: {
          protocolVersion: SERVICEHUB_TOOL_ADOPTION_PROTOCOL_VERSION,
          state: "candidate",
          activeToolCount: activeTools.length,
          candidateToolCount: candidateTools.length,
          reasonCode: "refresh_creates_candidate_catalog"
        },
        tools: allTools,
        tombstones,
        toolCount: allTools.length,
        activeToolCount: activeTools.length,
        candidateToolCount: candidateTools.length,
        tombstoneCount: tombstones.length,
        discoveredAt: discovery.discoveredAt,
        fingerprint: discovery.fingerprint
      }
    }
  };
  const cachePath = await writeCacheFile(userDataPath, nextCache);
  const catalogChange = externalMcpCatalogChange({
    source: catalogChangeSource,
    type: "external_service_catalog_refreshed",
    reasonCode: "external_service_catalog_refreshed",
    serviceId: config.serviceId,
    serviceCatalogVersionId: activeVersion.versionId,
    activeVersionId: activeVersion.versionId,
    candidateVersionId: candidateVersion.versionId,
    candidateFingerprint: candidateVersion.fingerprint,
    manifestFingerprint: resolvedManifestFingerprint,
    at: nextCache.updatedAt
  });
  const catalogChangeNotification = await notifyExternalMcpCatalogChange(
    catalogChangeListener || changeListener,
    catalogChange
  );
  return {
    ok: true,
    cachePath,
    serviceId: config.serviceId,
    toolCount: allTools.length,
    activeToolCount: activeTools.length,
    candidateToolCount: candidateTools.length,
    tools: candidateTools.map((tool) => tool.name),
    discoveredAt: discovery.discoveredAt,
    manifestId: resolvedManifestId,
    manifestFingerprint: resolvedManifestFingerprint,
    activeVersion: publicServiceVersion(activeVersion),
    candidateVersion: publicServiceVersion(candidateVersion),
    catalogChange,
    catalogChangeNotification
  };
}

export async function adoptExternalMcpCandidateTools({
  userDataPath = "",
  serviceId = "",
  toolNames = [],
  adoptAll = false,
  adoptedBy = "operator",
  expectedFingerprints = {},
  candidateVersionId = "",
  expectedCandidateVersionId = "",
  expectedCandidateFingerprint = "",
  acknowledgeRisk = false,
  allowRiskyTools = false,
  catalogChangeListener = null,
  changeListener = null,
  catalogChangeSource = "external-mcp-passthrough-runtime",
  catalogChangeType = "external_service_tools_adopted",
  catalogChangeReasonCode = ""
} = {}) {
  const id = String(serviceId || "").trim();
  if (!id) {
    throw new Error("ServiceHub tool adoption requires serviceId.");
  }
  const cache = readCacheFileSync(userDataPath);
  const service = cache.services?.[id] || null;
  if (!service) {
    const error = new Error(`External MCP service is not registered: ${id}`);
    error.code = "external_mcp_service_not_registered";
    throw error;
  }
  const requestedCandidateVersionId = String(candidateVersionId || expectedCandidateVersionId || "").trim();
  const candidateVersion = service.candidateVersion && typeof service.candidateVersion === "object"
    ? service.candidateVersion
    : null;
  if (requestedCandidateVersionId && requestedCandidateVersionId !== String(candidateVersion?.versionId || "").trim()) {
    const error = new Error(`ServiceHub candidate catalog version changed before promotion: ${id}`);
    error.code = "servicehub_stale_candidate_version";
    error.statusCode = 409;
    error.expectedCandidateVersionId = requestedCandidateVersionId;
    error.currentCandidateVersionId = String(candidateVersion?.versionId || "").trim();
    throw error;
  }
  const requestedCandidateFingerprint = String(expectedCandidateFingerprint || "").trim();
  if (requestedCandidateFingerprint && requestedCandidateFingerprint !== String(candidateVersion?.fingerprint || "").trim()) {
    const error = new Error(`ServiceHub candidate catalog fingerprint changed before promotion: ${id}`);
    error.code = "servicehub_stale_candidate_version";
    error.statusCode = 409;
    error.expectedCandidateFingerprint = requestedCandidateFingerprint;
    error.currentCandidateFingerprint = String(candidateVersion?.fingerprint || "").trim();
    throw error;
  }
  assertServiceHubProductionEvidence(service, { candidateVersion });
  const requestedNames = new Set(asArray(toolNames).map((name) => String(name || "").trim()).filter(Boolean));
  const expectedByName = asObject(expectedFingerprints);
  if (!adoptAll && requestedNames.size === 0) {
    const error = new Error("ServiceHub tool adoption requires toolNames or adoptAll=true.");
    error.code = "servicehub_tool_adoption_requires_selection";
    throw error;
  }
  const selectedCandidateNames = new Set(
    asArray(service.tools)
      .filter((tool) => {
        const name = String(tool?.name || "").trim();
        return name &&
          toolAdoptionState(tool) === "candidate" &&
          (adoptAll || requestedNames.has(name));
      })
      .map((tool) => String(tool?.name || "").trim())
  );
  const adoptedAt = nowIso();
  const nextTools = [];
  const adoptedNames = [];
  for (const tool of asArray(service.tools)) {
    const name = String(tool?.name || "").trim();
    const state = toolAdoptionState(tool);
    if (name && isAdoptedExternalTool(tool) && selectedCandidateNames.has(name)) {
      continue;
    }
    if (name && state === "candidate" && (adoptAll || requestedNames.has(name))) {
      assertServiceHubProductionInputSchemaClosed(service, tool);
      if (candidatePromotionBlocked(tool) && acknowledgeRisk !== true && allowRiskyTools !== true) {
        const error = new Error(`ServiceHub candidate tool requires explicit risk acknowledgement before promotion: ${name}`);
        error.code = "servicehub_candidate_requires_risk_acknowledgement";
        error.statusCode = 409;
        error.toolName = name;
        error.blockingFlagCodes = candidateBlockingFlagCodes(tool);
        throw error;
      }
      const expectedFingerprint = String(expectedByName[name] || "").trim();
      const currentFingerprint = String(tool?.adoption?.fingerprint || externalToolFingerprint(tool) || "").trim();
      if (expectedFingerprint && expectedFingerprint !== currentFingerprint) {
        const error = new Error(`ServiceHub candidate tool changed before adoption: ${name}`);
        error.code = "servicehub_stale_candidate_tool";
        error.statusCode = 409;
        error.toolName = name;
        error.expectedFingerprint = expectedFingerprint;
        error.currentFingerprint = currentFingerprint;
        throw error;
      }
      nextTools.push(adoptedExternalTool(tool, { adoptedAt, adoptedBy }));
      adoptedNames.push(name);
      continue;
    }
    nextTools.push(tool);
  }
  const missingNames = [...requestedNames].filter((name) => !adoptedNames.includes(name));
  if (missingNames.length) {
    const error = new Error(`ServiceHub candidate tools not found: ${missingNames.join(", ")}`);
    error.code = "servicehub_candidate_tools_not_found";
    error.missingToolNames = missingNames;
    throw error;
  }
  const activeTools = nextTools.filter((tool) => isAdoptedExternalTool(tool));
  const candidateTools = nextTools.filter((tool) => toolAdoptionState(tool) === "candidate");
  const previousActiveVersion = service.activeVersion && typeof service.activeVersion === "object"
    ? service.activeVersion
    : serviceToolVersionSnapshot({
        service,
        tools: asArray(service.tools).filter((tool) => isAdoptedExternalTool(tool)),
        tombstones: service.tombstones,
        state: "active",
        createdAt: String(service.discoveredAt || adoptedAt),
        reasonCode: "active_catalog_snapshot_before_promotion"
      });
  const activeVersion = serviceToolVersionSnapshot({
    service,
    tools: activeTools,
    tombstones: service.tombstones,
    state: "active",
    baseVersionId: previousActiveVersion.versionId,
    createdAt: adoptedAt,
    createdBy: adoptedBy,
    reasonCode: "operator_promoted_candidate"
  });
  activeVersion.promotedCandidateFingerprint = String(candidateVersion?.fingerprint || "").trim();
  const nextCandidateVersion = serviceToolVersionSnapshot({
    service,
    tools: candidateTools,
    tombstones: service.tombstones,
    state: "candidate",
    baseVersionId: activeVersion.versionId,
    createdAt: adoptedAt,
    createdBy: adoptedBy,
    reasonCode: candidateTools.length ? "remaining_candidates_after_promotion" : "no_remaining_candidates"
  });
  const rollbackVersions = uniqueRollbackVersions([
    ...(previousActiveVersion.toolCount > 0 ? [previousActiveVersion] : []),
    ...asArray(service.rollbackVersions)
  ]);
  const nextService = {
    ...service,
    adoption: {
      protocolVersion: SERVICEHUB_TOOL_ADOPTION_PROTOCOL_VERSION,
      state: candidateTools.length ? "partially_adopted" : "adopted",
      adoptedAt,
      adoptedBy: String(adoptedBy || "operator").trim(),
      activeToolCount: activeTools.length,
      candidateToolCount: candidateTools.length,
      adoptedToolNames: adoptedNames.sort(),
      reasonCode: "operator_adopted_candidate"
    },
    serviceCatalogVersionId: activeVersion.versionId,
    activeVersionId: activeVersion.versionId,
    activeVersion,
    productionEvidenceCandidateFingerprint: String(candidateVersion?.fingerprint || "").trim(),
    candidateVersion: nextCandidateVersion,
    rollbackVersions,
    tools: nextTools,
    toolCount: nextTools.length,
    activeToolCount: activeTools.length,
    candidateToolCount: candidateTools.length
  };
  const nextCache = {
    ...cache,
    updatedAt: adoptedAt,
    services: {
      ...cache.services,
      [id]: nextService
    }
  };
  const cachePath = await writeCacheFile(userDataPath, nextCache);
  const resolvedCatalogChangeType = String(catalogChangeType || "external_service_tools_adopted").trim();
  const catalogChange = externalMcpCatalogChange({
    source: catalogChangeSource,
    type: resolvedCatalogChangeType,
    reasonCode: String(catalogChangeReasonCode || resolvedCatalogChangeType).trim(),
    serviceId: id,
    serviceCatalogVersionId: activeVersion.versionId,
    activeVersionId: activeVersion.versionId,
    candidateVersionId: nextCandidateVersion.versionId,
    candidateFingerprint: nextCandidateVersion.fingerprint,
    manifestFingerprint: String(service.manifestFingerprint || "").trim(),
    at: adoptedAt
  });
  const catalogChangeNotification = await notifyExternalMcpCatalogChange(
    catalogChangeListener || changeListener,
    catalogChange
  );
  return {
    ok: true,
    cachePath,
    serviceId: id,
    adoptedAt,
    adoptedBy: String(adoptedBy || "operator").trim(),
    adoptedToolNames: adoptedNames.sort(),
    activeToolCount: activeTools.length,
    candidateToolCount: candidateTools.length,
    promotedAt: adoptedAt,
    promotedBy: String(adoptedBy || "operator").trim(),
    promotedToolNames: adoptedNames.sort(),
    activeVersion: publicServiceVersion(activeVersion),
    candidateVersion: publicServiceVersion(nextCandidateVersion),
    rollbackTargetVersionId: previousActiveVersion.toolCount > 0 ? previousActiveVersion.versionId : "",
    rollbackVersionCount: rollbackVersions.length,
    catalogChange,
    catalogChangeNotification
  };
}

export async function promoteExternalMcpCandidateVersion({
  userDataPath = "",
  serviceId = "",
  toolNames = [],
  adoptAll = false,
  promotedBy = "operator",
  expectedFingerprints = {},
  candidateVersionId = "",
  expectedCandidateVersionId = "",
  expectedCandidateFingerprint = "",
  acknowledgeRisk = false,
  allowRiskyTools = false,
  catalogChangeListener = null,
  changeListener = null,
  catalogChangeSource = "external-mcp-passthrough-runtime"
} = {}) {
  return adoptExternalMcpCandidateTools({
    userDataPath,
    serviceId,
    toolNames,
    adoptAll,
    adoptedBy: promotedBy,
    expectedFingerprints,
    candidateVersionId,
    expectedCandidateVersionId,
    expectedCandidateFingerprint,
    acknowledgeRisk,
    allowRiskyTools,
    catalogChangeListener,
    changeListener,
    catalogChangeSource,
    catalogChangeType: "external_service_catalog_promoted",
    catalogChangeReasonCode: "external_service_catalog_promoted"
  });
}

export async function rollbackExternalMcpVersion({
  userDataPath = "",
  serviceId = "",
  targetVersionId = "",
  rolledBackBy = "operator",
  reason = "operator_rollback",
  catalogChangeListener = null,
  changeListener = null,
  catalogChangeSource = "external-mcp-passthrough-runtime"
} = {}) {
  const id = String(serviceId || "").trim();
  if (!id) {
    throw new Error("ServiceHub rollback requires serviceId.");
  }
  const cache = readCacheFileSync(userDataPath);
  const service = cache.services?.[id] || null;
  if (!service) {
    const error = new Error(`External MCP service is not registered: ${id}`);
    error.code = "external_mcp_service_not_registered";
    throw error;
  }
  const requestedVersionId = String(targetVersionId || "").trim();
  const rollbackVersions = asArray(service.rollbackVersions);
  const targetVersion = rollbackVersions.find((version) =>
    requestedVersionId
      ? String(version?.versionId || "").trim() === requestedVersionId
      : String(version?.versionId || "").trim()
  );
  if (!targetVersion) {
    const error = new Error(requestedVersionId
      ? `ServiceHub rollback target not found: ${requestedVersionId}`
      : `ServiceHub rollback target not found for service: ${id}`);
    error.code = "servicehub_rollback_target_not_found";
    error.statusCode = 404;
    error.targetVersionId = requestedVersionId;
    throw error;
  }
  const rolledBackAt = nowIso();
  const currentActiveVersion = service.activeVersion && typeof service.activeVersion === "object"
    ? service.activeVersion
    : serviceToolVersionSnapshot({
        service,
        tools: asArray(service.tools).filter((tool) => isAdoptedExternalTool(tool)),
        tombstones: service.tombstones,
        state: "active",
        createdAt: String(service.discoveredAt || rolledBackAt),
        reasonCode: "active_catalog_snapshot_before_rollback"
      });
  const restoredActiveTools = asArray(targetVersion.tools)
    .filter((tool) => String(tool?.name || "").trim())
    .map((tool) => adoptedExternalTool(tool, {
      adoptedAt: rolledBackAt,
      adoptedBy: rolledBackBy,
      reasonCode: "operator_rolled_back_service_version"
    }));
  const restoredNames = new Set(restoredActiveTools.map((tool) => String(tool?.name || "").trim()).filter(Boolean));
  const preservedCandidates = asArray(service.tools)
    .filter((tool) => toolAdoptionState(tool) === "candidate")
    .filter((tool) => !restoredNames.has(String(tool?.name || "").trim()));
  const nextTools = [...restoredActiveTools, ...preservedCandidates];
  const activeVersion = serviceToolVersionSnapshot({
    service,
    tools: restoredActiveTools,
    tombstones: service.tombstones,
    state: "active",
    baseVersionId: currentActiveVersion.versionId,
    createdAt: targetVersion.createdAt || rolledBackAt,
    createdBy: rolledBackBy,
    reasonCode: "operator_rolled_back_service_version",
    existingVersion: targetVersion
  });
  const candidateVersion = serviceToolVersionSnapshot({
    service,
    tools: preservedCandidates,
    tombstones: service.tombstones,
    state: "candidate",
    baseVersionId: activeVersion.versionId,
    createdAt: rolledBackAt,
    createdBy: rolledBackBy,
    reasonCode: preservedCandidates.length ? "candidates_preserved_after_rollback" : "no_remaining_candidates"
  });
  const nextRollbackVersions = uniqueRollbackVersions([
    ...(currentActiveVersion.toolCount > 0 ? [currentActiveVersion] : []),
    ...rollbackVersions.filter((version) => String(version?.versionId || "").trim() !== String(targetVersion.versionId || "").trim())
  ]);
  const activeTools = nextTools.filter((tool) => isAdoptedExternalTool(tool));
  const candidateTools = nextTools.filter((tool) => toolAdoptionState(tool) === "candidate");
  const nextService = {
    ...service,
    adoption: {
      protocolVersion: SERVICEHUB_TOOL_ADOPTION_PROTOCOL_VERSION,
      state: candidateTools.length ? "rolled_back_with_candidates" : "rolled_back",
      adoptedAt: rolledBackAt,
      adoptedBy: String(rolledBackBy || "operator").trim(),
      activeToolCount: activeTools.length,
      candidateToolCount: candidateTools.length,
      adoptedToolNames: activeTools.map((tool) => String(tool?.name || "").trim()).filter(Boolean).sort(),
      reasonCode: String(reason || "operator_rollback").trim()
    },
    serviceCatalogVersionId: activeVersion.versionId,
    activeVersionId: activeVersion.versionId,
    activeVersion,
    candidateVersion,
    rollbackVersions: nextRollbackVersions,
    tools: nextTools,
    toolCount: nextTools.length,
    activeToolCount: activeTools.length,
    candidateToolCount: candidateTools.length
  };
  const nextCache = {
    ...cache,
    updatedAt: rolledBackAt,
    services: {
      ...cache.services,
      [id]: nextService
    }
  };
  const cachePath = await writeCacheFile(userDataPath, nextCache);
  const catalogChange = externalMcpCatalogChange({
    source: catalogChangeSource,
    type: "external_service_catalog_rolled_back",
    reasonCode: "external_service_catalog_rolled_back",
    serviceId: id,
    serviceCatalogVersionId: activeVersion.versionId,
    activeVersionId: activeVersion.versionId,
    candidateVersionId: candidateVersion.versionId,
    candidateFingerprint: candidateVersion.fingerprint,
    manifestFingerprint: String(service.manifestFingerprint || "").trim(),
    at: rolledBackAt,
    invalidation: {
      reasonCode: "rollback_requires_runtime_reprojection",
      scopes: [...SERVICEHUB_RUNTIME_INVALIDATION_SCOPES]
    }
  });
  const catalogChangeNotification = await notifyExternalMcpCatalogChange(
    catalogChangeListener || changeListener,
    catalogChange
  );
  return {
    ok: true,
    cachePath,
    serviceId: id,
    rolledBackAt,
    rolledBackBy: String(rolledBackBy || "operator").trim(),
    reason: String(reason || "operator_rollback").trim(),
    targetVersionId: targetVersion.versionId,
    activeVersion: publicServiceVersion(activeVersion),
    candidateVersion: publicServiceVersion(candidateVersion),
    rollbackVersionCount: nextRollbackVersions.length,
    activeToolCount: activeTools.length,
    candidateToolCount: candidateTools.length,
    restoredToolNames: activeTools.map((tool) => String(tool?.name || "").trim()).filter(Boolean).sort(),
    catalogChange,
    catalogChangeNotification
  };
}

function virtualOperationFromTool(service, tool, { legacyActive = false } = {}) {
  const serviceSegment = safeSegment(service.serviceId);
  const toolSegment = safeSegment(tool.name);
  const isMcp = service?.upstream?.type === "mcp" && service?.binding?.mode === "passthrough";
  const isRpc = service?.upstream?.type === "rpc" || service?.upstream?.type === "json-rpc" || Boolean(tool.rpc);
  const isModelGateway = service?.upstream?.type === "llm" || Boolean(tool.modelGateway);
  const operationPrefix = isMcp ? "external.mcp" : isRpc ? "external.rpc" : isModelGateway ? "external.model" : "external.http";
  const toolPrefix = isMcp ? "pact.externalMcp" : isRpc ? "pact.externalRpc" : isModelGateway ? "pact.externalModel" : "pact.externalHttp";
  const operationId = `${operationPrefix}.${serviceSegment}.${toolSegment}`;
  const toolId = `${toolPrefix}.${serviceSegment}.${toolSegment}`;
  const requiredScopes = uniqueStrings(tool.requiredScopes || service.binding?.requiredScopes || ["knowledge:read"]);
  const risk = String(tool.risk || service.binding?.risk || "read_only");
  const adoption = asObject(tool.adoption, {});
  const toolFingerprint = externalToolFingerprint(tool);
  const adoptionFingerprint = String(adoption.fingerprint || toolFingerprint).trim();
  const manifestId = String(service.manifestId || "").trim();
  const manifestFingerprint = String(service.manifestFingerprint || "").trim();
  const serviceCatalogVersionId = String(
    service.serviceCatalogVersionId || service.activeVersionId || service.activeVersion?.versionId || ""
  ).trim();
  const catalogBindingFingerprint = fingerprint({
    serviceId: service.serviceId,
    manifestId,
    manifestFingerprint,
    serviceCatalogVersionId,
    upstreamToolName: tool.name,
    toolFingerprint: adoptionFingerprint,
    serviceFingerprint: service.fingerprint || "",
    adoptionState: toolAdoptionState(tool, { legacyActive }),
    risk,
    requiredScopes,
    inputSchema: tool.inputSchema || { type: "object" },
    transport: summarizeTransport(tool)
  });
  return {
    id: operationId,
    toolId,
    feature: "external",
    featureId: isMcp ? "external-mcp" : isRpc ? "external-rpc" : isModelGateway ? "external-model-gateway" : "external-http",
    label: `${service.displayName || service.serviceId}: ${tool.title || tool.name}`,
    description: tool.description || (
      isMcp
        ? `Passthrough MCP tool ${tool.name} from external service ${service.serviceId}.`
        : isRpc
          ? `Compiled RPC tool ${tool.name} from external service ${service.serviceId}.`
          : isModelGateway
            ? `Compiled model gateway tool ${tool.name} from external service ${service.serviceId}.`
            : `Compiled HTTP tool ${tool.name} from external service ${service.serviceId}.`
    ),
    target: {
      controller: isMcp ? "externalMcp" : isRpc ? "externalRpc" : isModelGateway ? "externalModel" : "externalHttp",
      method: "execute"
    },
    http: {
      method: "POST",
      path: isMcp
        ? `/api/external/mcp/${encodeURIComponent(service.serviceId)}/tools/${encodeURIComponent(tool.name)}`
        : isRpc
          ? `/api/external/rpc/${encodeURIComponent(service.serviceId)}/tools/${encodeURIComponent(tool.name)}`
          : isModelGateway
            ? `/api/external/model/${encodeURIComponent(service.serviceId)}/tools/${encodeURIComponent(tool.name)}`
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
          : isModelGateway
            ? EXTERNAL_MODEL_GATEWAY_VIRTUAL_OPERATION_ASPECT
            : EXTERNAL_HTTP_COMPILE_VIRTUAL_OPERATION_ASPECT,
      "external-service",
      "service-hub"
    ],
    externalMcp: {
      serviceId: service.serviceId,
      upstreamToolName: tool.name,
      upstream: service.upstream,
      binding: service.binding || {},
      manifestId,
      manifestFingerprint,
      serviceCatalogVersionId,
      activeVersionId: serviceCatalogVersionId,
      serviceFingerprint: String(service.fingerprint || "").trim(),
      discoveredAt: String(service.discoveredAt || "").trim(),
      toolFingerprint: adoptionFingerprint,
      currentToolFingerprint: toolFingerprint,
      catalogBindingFingerprint,
      adoption: {
        protocolVersion: String(adoption.protocolVersion || SERVICEHUB_TOOL_ADOPTION_PROTOCOL_VERSION),
        state: toolAdoptionState(tool, { legacyActive }),
        fingerprint: adoptionFingerprint,
        previousFingerprint: String(adoption.previousFingerprint || "").trim(),
        reasonCode: String(adoption.reasonCode || "").trim(),
        discoveredAt: String(adoption.discoveredAt || service.discoveredAt || "").trim(),
        adoptedAt: String(adoption.adoptedAt || "").trim(),
        adoptedBy: String(adoption.adoptedBy || "").trim()
      }
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
    if (!evaluateServiceHubProductionEvidence(service).ok) {
      continue;
    }
    const legacyActive = legacyActiveToolCacheAllowed(service);
    for (const tool of asArray(service.tools)) {
      if (!tool?.name) {
        continue;
      }
      if (!isAdoptedExternalTool(tool, { legacyActive })) {
        continue;
      }
      operations.push(virtualOperationFromTool(service, tool, { legacyActive }));
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
    const legacyActive = legacyActiveToolCacheAllowed(service);
    const activeTools = asArray(service.tools)
      .filter((tool) => isAdoptedExternalTool(tool, { legacyActive }));
    const candidateToolRecords = asArray(service.tools)
      .filter((tool) => toolAdoptionState(tool, { legacyActive }) === "candidate");
    const activeToolNames = activeTools
      .map((tool) => String(tool?.name || "").trim())
      .filter(Boolean)
      .sort();
    const candidateToolNames = candidateToolRecords
      .map((tool) => String(tool?.name || "").trim())
      .filter(Boolean)
      .sort();
    const activeToolDetails = activeTools
      .map((tool) => externalToolReviewDetail(tool, { legacyActive }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const candidateToolDetails = candidateToolRecords
      .map((tool) => externalToolReviewDetail(tool, { legacyActive }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const tombstones = asArray(service.tombstones)
      .map((tombstone) => ({
        protocolVersion: String(tombstone?.protocolVersion || "v0.0.1:external-service:servicehub-tool-tombstone-1"),
        state: String(tombstone?.state || ""),
        name: String(tombstone?.name || "").trim(),
        title: String(tombstone?.title || tombstone?.name || "").trim(),
        toolFingerprint: String(tombstone?.toolFingerprint || "").trim(),
        previousFingerprint: String(tombstone?.previousFingerprint || "").trim(),
        firstMissingAt: String(tombstone?.firstMissingAt || "").trim(),
        lastMissingAt: String(tombstone?.lastMissingAt || "").trim(),
        lastSeenAt: String(tombstone?.lastSeenAt || "").trim(),
        discoveryFingerprint: String(tombstone?.discoveryFingerprint || "").trim(),
        reasonCode: String(tombstone?.reasonCode || "").trim()
      }))
      .filter((tombstone) => tombstone.name)
      .sort((left, right) => left.name.localeCompare(right.name));
    services[service.serviceId] = {
      serviceId: service.serviceId,
      upstream: service.upstream || null,
      binding: service.binding || null,
      toolCount: Number(service.toolCount || asArray(service.tools).length || 0),
      activeToolCount: Number(service.activeToolCount === undefined ? activeToolNames.length : service.activeToolCount),
      candidateToolCount: Number(service.candidateToolCount === undefined ? candidateToolNames.length : service.candidateToolCount),
      tools: asArray(service.tools).map((tool) => String(tool?.name || "").trim()).filter(Boolean).sort(),
      activeTools: activeToolNames,
      candidateTools: candidateToolNames,
      activeToolDetails,
      candidateToolDetails,
      tombstones,
      tombstoneCount: tombstones.length,
      adoption: service.adoption || null,
      legacyMigration: legacyToolCacheMigration(service),
      manifestId: String(service.manifestId || "").trim(),
      manifestFingerprint: String(service.manifestFingerprint || "").trim(),
      serviceCatalogVersionId: String(service.serviceCatalogVersionId || service.activeVersionId || service.activeVersion?.versionId || "").trim(),
      activeVersionId: String(service.activeVersionId || service.activeVersion?.versionId || "").trim(),
      activeVersion: publicServiceVersion(service.activeVersion),
      candidateVersion: publicServiceVersion(service.candidateVersion),
      rollbackVersions: asArray(service.rollbackVersions).map(publicServiceVersion).filter(Boolean),
      rollbackVersionCount: asArray(service.rollbackVersions).length,
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
    Accept: service.upstream?.type === "llm"
      ? "application/json, text/event-stream, text/plain"
      : service.upstream?.type === "sse" || tool.sse
        ? "text/event-stream, application/json, text/plain"
      : "application/json, text/plain",
    ...safeHeaderMap(service.upstream?.defaultHeaders),
    ...safeHeaderMap(tool.transport?.headers),
    ...safeHeaderMap(renderTemplateValue(asObject(request.headers), input, context))
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

async function parseHttpToolResponse(response, {
  sseMaxEvents = 1,
  sseMaxBytes = MAX_EXTERNAL_SERVICE_RESPONSE_BYTES,
  sseEventTypes = [],
  rejectEventStream = false,
  signal = undefined
} = {}) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/event-stream")) {
    if (rejectEventStream) {
      const error = externalStreamingRejectedError("External model gateway streaming response");
      error.streamEvidence = await cancelStreamingResponseWithEvidence(response, {
        label: "External model gateway streaming response",
        reason: "model_gateway_event_stream_rejected"
      });
      throw error;
    }
    return readGenericSseEventsWithLimit(response, {
      label: "External HTTP SSE tool response",
      maxBytes: sseMaxBytes,
      maxEvents: sseMaxEvents,
      eventTypes: sseEventTypes,
      signal
    });
  }
  const text = await readResponseTextWithLimit(response, { label: "External HTTP tool response" });
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

async function callCompiledHttpTool({
  service,
  toolName,
  input = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  userDataPath = "",
  runtimeContext = {},
  signal = undefined
} = {}) {
  const tool = asArray(service.tools).find((item) => item?.name === toolName);
  if (!tool) {
    const error = new Error(`External HTTP tool is not registered: ${service.serviceId}/${toolName}`);
    error.code = "external_http_tool_not_registered";
    throw error;
  }
  assertServiceHubCallableTool(service, tool, {
    legacyActive: legacyActiveToolCacheAllowed(service)
  });
  validateExternalToolInputSchema({
    service,
    tool,
    input
  });
  const controller = new AbortController();
  const abortSignals = combineAbortSignals([controller.signal, signal]);
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs || DEFAULT_TIMEOUT_MS)));
  const startedAtMs = Date.now();
  let pinnedFetch = null;
  try {
    const isRpc = service.upstream?.type === "rpc" || service.upstream?.type === "json-rpc" || Boolean(tool.rpc);
    const isModelGateway = service.upstream?.type === "llm" || Boolean(tool.modelGateway);
    if (isModelGateway && asObject(input).stream === true) {
      throw externalStreamingRejectedError("External model gateway streaming request");
    }
    const request = buildCompiledHttpRequest({
      service,
      tool,
      input: asObject(input)
    });
    const authHeaders = await resolveUpstreamAuthHeaders({
      upstream: service.upstream,
      userDataPath,
      serviceId: service.serviceId,
      url: request.url,
      requiredScopes: tool.requiredScopes || service.binding?.requiredScopes,
      tenantId: runtimeContext.tenantId,
      workspaceId: runtimeContext.workspaceId,
      authBindingId: runtimeContext.authBindingId
    });
    pinnedFetch = await fetchServiceHubRuntimeWithPinnedDns(service, request.url, "tools[].transport.url", {
      ...request.init,
      headers: {
        ...request.init.headers,
        ...trustedHeaderMap(authHeaders)
      },
      redirect: "manual",
      signal: abortSignals.signal
    });
    const { response, egressDecision } = pinnedFetch;
    const redirectDecision = isHttpRedirectStatus(response.status)
      ? await evaluateServiceHubRedirectDecision(service, {
          sourceUrl: request.url,
          status: response.status,
          location: response.headers.get("location") || "",
          label: "tools[].transport.url.redirectLocation"
        })
      : null;
    const streamingPolicy = asObject(service.policies?.streaming);
    const payload = isHttpRedirectStatus(response.status)
      ? null
      : await parseHttpToolResponse(response, {
          sseMaxEvents: tool.sse?.maxEvents || tool.response?.maxEvents || 1,
          sseMaxBytes: tool.sse?.maxBytes ||
            tool.response?.maxBytes ||
            streamingPolicy.maxBytes ||
            streamingPolicy.max_bytes ||
            MAX_EXTERNAL_SERVICE_RESPONSE_BYTES,
          sseEventTypes: tool.sse?.eventTypes || [],
          rejectEventStream: isModelGateway,
          signal: abortSignals.signal
        });
    if (!response.ok) {
      const error = new Error(`External HTTP tool ${toolName} returned HTTP ${response.status}.`);
      error.statusCode = response.status;
      error.payload = payload;
      error.redirectDecision = redirectDecision;
      error.egressDecision = egressDecision;
      throw error;
    }
    if (isRpc && payload && typeof payload === "object" && !Array.isArray(payload) && payload.error) {
      const rpcError = asObject(payload.error);
      const error = new Error(rpcError.message || `External JSON-RPC error for ${toolName}.`);
      error.code = "external_rpc_error";
      error.rpcCode = rpcError.code;
      error.statusCode = 502;
      error.payload = payload;
      throw error;
    }
    const durationMs = Date.now() - startedAtMs;
    const streamEvidence = payload && typeof payload === "object" && !Array.isArray(payload) && payload.streamEvidence?.protocol === "sse"
      ? payload.streamEvidence
      : null;
    const resultPayload = tool.sse && Array.isArray(payload?.events)
      ? {
          ...payload,
          events: payload.events.slice(0, Math.max(1, Number(tool.sse.maxEvents || tool.response?.maxEvents || 1)))
        }
      : payload;
    return {
      ok: true,
      protocolVersion: isRpc
        ? EXTERNAL_RPC_COMPILE_PROTOCOL_VERSION
        : isModelGateway
          ? EXTERNAL_MODEL_GATEWAY_PROTOCOL_VERSION
          : EXTERNAL_HTTP_COMPILE_PROTOCOL_VERSION,
      serviceId: service.serviceId,
      upstreamToolName: toolName,
      upstream: {
        type: service.upstream?.type || "",
        transport: "http",
        url: externalHttpBaseUrl(service),
        ...(isModelGateway ? {
          modelProtocol: String(service.upstream?.modelProtocol || tool.modelGateway?.protocol || "").trim(),
          provider: String(service.upstream?.provider || tool.modelGateway?.provider || "").trim()
        } : {})
      },
      egressDecision,
      durationMs,
      ...(streamEvidence ? { streamEvidence } : {}),
      result: applyResultPath(resultPayload, tool.rpc?.resultPath || tool.response?.resultPath)
    };
  } finally {
    await pinnedFetch?.close?.();
    clearTimeout(timeout);
    abortSignals.cleanup();
  }
}

export function createExternalMcpPassthroughRuntime({ userDataPath = "", logger = null } = {}) {
  const inFlightByService = new Map();
  let inFlightSequence = 0;

  function getServiceFromCache(serviceId) {
    const cache = readCacheFileSync(userDataPath);
    return cache.services?.[String(serviceId || "").trim()] || null;
  }

  function activeVersionIdFromService(service = {}) {
    return String(
      service.serviceCatalogVersionId || service.activeVersionId || service.activeVersion?.versionId || ""
    ).trim();
  }

  function registerInFlight(service = {}, toolName = "") {
    const serviceId = String(service.serviceId || "").trim();
    const entry = {
      id: `external-service-inflight-${++inFlightSequence}`,
      serviceId,
      toolName: String(toolName || "").trim(),
      activeVersionId: activeVersionIdFromService(service),
      startedAt: new Date().toISOString(),
      controller: new AbortController(),
      sessions: new Set(),
      released: false
    };
    if (!inFlightByService.has(serviceId)) {
      inFlightByService.set(serviceId, new Map());
    }
    inFlightByService.get(serviceId).set(entry.id, entry);
    return {
      ...entry,
      signal: entry.controller.signal,
      trackSession(session = null) {
        if (session && typeof session === "object") {
          entry.sessions.add(session);
        }
        return session;
      },
      release() {
        if (entry.released) {
          return;
        }
        entry.released = true;
        entry.sessions.clear();
        const byId = inFlightByService.get(serviceId);
        byId?.delete(entry.id);
        if (byId && byId.size === 0) {
          inFlightByService.delete(serviceId);
        }
      }
    };
  }

  function assertActiveVersionUnchanged(inFlight, toolName = "") {
    const expected = String(inFlight?.activeVersionId || "").trim();
    if (!expected) {
      return;
    }
    const current = activeVersionIdFromService(getServiceFromCache(inFlight.serviceId) || {});
    if (!current || current === expected) {
      return;
    }
    const error = new Error(`External service active catalog version changed while calling ${inFlight.serviceId}/${toolName}.`);
    error.code = "servicehub_active_version_changed";
    error.statusCode = 409;
    error.serviceId = inFlight.serviceId;
    error.toolName = String(toolName || inFlight.toolName || "").trim();
    error.previousActiveVersionId = expected;
    error.currentActiveVersionId = current;
    throw error;
  }

  function normalizeInvalidationScopes(catalogChange = {}) {
    return uniqueStrings(
      asArray(catalogChange?.invalidation?.scopes || catalogChange?.scopes)
        .map((scope) => String(scope || "").trim())
    );
  }

  function invalidateRuntimeState(catalogChange = {}) {
    const scopes = normalizeInvalidationScopes(catalogChange);
    const serviceId = String(catalogChange?.serviceId || catalogChange?.invalidation?.serviceId || "").trim();
    const reasonCode = String(catalogChange?.invalidation?.reasonCode || catalogChange?.reasonCode || "").trim();
    const shouldAbort = scopes.length === 0 || scopes.some((scope) =>
      scope === "external-service-runtime-cache" || scope === "upstream-session"
    );
    const matched = [];
    for (const [entryServiceId, entries] of inFlightByService.entries()) {
      if (serviceId && entryServiceId !== serviceId) {
        continue;
      }
      matched.push(...entries.values());
    }
    let inFlightAbortedCount = 0;
    let upstreamSessionInvalidatedCount = 0;
    if (shouldAbort) {
      for (const entry of matched) {
        if (!entry.controller.signal.aborted) {
          entry.controller.abort();
          inFlightAbortedCount += 1;
        }
        for (const session of entry.sessions) {
          upstreamSessionInvalidatedCount += 1;
          Promise.resolve(session.close?.()).catch(() => null);
        }
      }
    }
    return {
      ok: true,
      serviceId,
      reasonCode,
      scopes,
      activeVersionId: String(catalogChange?.activeVersionId || catalogChange?.serviceCatalogVersionId || "").trim(),
      inFlightTrackedCount: matched.length,
      inFlightAbortedCount,
      upstreamSessionInvalidatedCount,
      runtimeCacheInvalidated: scopes.includes("external-service-runtime-cache"),
      healthStateInvalidated: 0
    };
  }

  async function refreshConfig(config, options = {}) {
    return refreshExternalMcpToolCache({
      userDataPath,
      config,
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS
    });
  }

  async function callTool({ serviceId, toolName, input = {}, timeoutMs = DEFAULT_TIMEOUT_MS, context = {} } = {}) {
    const service = serviceWithRuntimePolicyEnvelope(getServiceFromCache(serviceId));
    if (!service) {
      const error = new Error(`External MCP service is not registered: ${serviceId}`);
      error.code = "external_mcp_service_not_registered";
      throw error;
    }
    const inFlight = registerInFlight(service, toolName);
    const runtimeContext = {
      tenantId: String(context?.tenantId || "").trim(),
      workspaceId: String(context?.workspaceId || "").trim(),
      authBindingId: String(context?.authBindingId || context?.bindingId || "").trim()
    };
    try {
      if (service.upstream?.type !== "mcp") {
        const result = await callCompiledHttpTool({
          service,
          toolName,
          input,
          timeoutMs,
          userDataPath,
          runtimeContext,
          signal: inFlight.signal
        });
        assertActiveVersionUnchanged(inFlight, toolName);
        logger?.info?.("external_http.tool_call.completed", {
          serviceId,
          toolName,
          durationMs: result.durationMs
        });
        return result;
      }
      const registeredTool = asArray(service.tools).find((tool) => String(tool?.name || "").trim() === String(toolName || "").trim());
      if (!registeredTool) {
        const error = new Error(`External MCP tool is not registered: ${service.serviceId}/${toolName}`);
        error.code = "external_mcp_tool_not_registered";
        error.statusCode = 404;
        error.serviceId = String(service.serviceId || "").trim();
        error.toolName = String(toolName || "").trim();
        throw error;
      }
      assertServiceHubCallableTool(service, registeredTool, {
        legacyActive: legacyActiveToolCacheAllowed(service)
      });
      validateExternalToolInputSchema({
        service,
        tool: registeredTool,
        input
      });
      const session = inFlight.trackSession(await initializeExternalMcpSession({
        config: {
          serviceId: service.serviceId,
          serviceName: service.serviceName,
          displayName: service.displayName,
          policyPreset: service.policyPreset,
          policies: service.policies,
          userDataPath,
          ...runtimeContext,
          upstream: service.upstream,
          binding: service.binding
        },
        timeoutMs,
        signal: inFlight.signal
      }));
      const startedAtMs = Date.now();
      let runtimeResult = null;
      try {
        const result = await session.postJsonRpc({
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
        assertActiveVersionUnchanged(inFlight, toolName);
        runtimeResult = {
          ok: true,
          protocolVersion: EXTERNAL_MCP_PROTOCOL_VERSION,
          serviceId: service.serviceId,
          upstreamToolName: toolName,
          upstream: {
            type: "mcp",
            transport: service.upstream?.transport || "",
            url: service.upstream?.url || "",
            ...(session.postUrl ? { messageEndpointUrl: session.postUrl } : {})
          },
          egressDecision: result.egressDecision || session.messageEndpointEgressDecision || session.egressDecision || null,
          durationMs,
          result: result.result
        };
        return runtimeResult;
      } finally {
        const streamEvidence = await session.close?.({
          reason: runtimeResult ? "tool_call_completed" : "tool_call_cleanup",
          failedClosed: !runtimeResult
        });
        if (runtimeResult && streamEvidence) {
          runtimeResult.streamEvidence = streamEvidence;
        }
      }
    } finally {
      inFlight.release();
    }
  }

  return Object.freeze({
    protocolVersion: EXTERNAL_MCP_PROTOCOL_VERSION,
    refreshConfig,
    callTool,
    invalidateRuntimeState,
    listVirtualOperationsSync: () => listExternalMcpVirtualOperationsSync({ userDataPath })
  });
}
