import crypto from "node:crypto";
import { isIP } from "node:net";
import {
  dispatchOperation,
  getRuntimeLogger,
  summarizeError,
  summarizeForLog,
  traceContextFromRequest
} from "../../../../interactive/product-api.mjs";

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
}

function parseJsonObject(value) {
  if (!value) {
    return {};
  }
  if (Buffer.isBuffer(value)) {
    return value.length ? parseJsonObject(value.toString("utf8")) : {};
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return {};
    }
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function trustedApprovedPendingOperation(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return String(value.pendingOperationId || "").trim() ? value : null;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function sortedStrings(values = []) {
  return uniqueStrings(Array.isArray(values) ? values : []).sort();
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

function fingerprintValue(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function createCapturedResponse() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = {
        ...this.headers,
        ...headers
      };
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    getHeader(name) {
      const lowerName = String(name || "").toLowerCase();
      const entry = Object.entries(this.headers).find(
        ([headerName]) => headerName.toLowerCase() === lowerName
      );
      return entry?.[1];
    },
    write(chunk) {
      if (chunk !== undefined && chunk !== null) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    },
    end(chunk) {
      this.write(chunk);
      this.ended = true;
    }
  };
}

function capturedBuffer(captured) {
  return Buffer.concat(captured.chunks || []);
}

function parseCapturedJson(captured) {
  const text = capturedBuffer(captured).toString("utf8").trim();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function policyRevisionSummary(policy = {}) {
  const revision = policy.governancePolicyRevision &&
    typeof policy.governancePolicyRevision === "object" &&
    !Array.isArray(policy.governancePolicyRevision)
    ? policy.governancePolicyRevision
    : {};
  return {
    decisionId: policy.decisionId || "",
    effect: policy.effect || "",
    reasonCode: policy.reasonCode || "",
    grantPolicyRevision: Number(policy.grantPolicyRevision || 0),
    grantPolicyState: String(policy.grantPolicyState || ""),
    governancePolicyRevision: {
      protocolVersion: String(revision.protocolVersion || ""),
      revision: Number(revision.revision || 0),
      updatedAt: String(revision.updatedAt || "")
    }
  };
}

function sourceIpFromRequest(request) {
  return String(
    request?.headers?.["x-forwarded-for"] ||
      request?.socket?.remoteAddress ||
      request?.connection?.remoteAddress ||
      ""
  ).split(",")[0].trim();
}

function buildDirectOperationRequest({ operation, input = {} }) {
  const explicitBody =
    input.body !== undefined &&
    input.body &&
    typeof input.body === "object" &&
    !Array.isArray(input.body);
  const body = explicitBody ? input.body : input;
  const params = {
    ...(input.params && typeof input.params === "object" && !Array.isArray(input.params) ? input.params : {})
  };
  const pathParamNames = [...String(operation.http?.path || "").matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  for (const name of pathParamNames) {
    if (params[name] === undefined && input[name] !== undefined) {
      params[name] = input[name];
      continue;
    }
    const paramDefinition = [
      ...(operation.http?.params || []),
      ...(operation.rpc?.params || [])
    ].find((item) => item.name === name);
    const aliasValue = (paramDefinition?.aliases || []).map((alias) => input[alias]).find(
      (item) => item !== undefined && item !== null && item !== ""
    );
    if (params[name] === undefined && aliasValue !== undefined) {
      params[name] = aliasValue;
    }
  }
  let path = operation.http?.path || "/";
  for (const name of pathParamNames) {
    path = path.replace(`:${name}`, encodeURIComponent(String(params[name] || "")));
  }
  const url = new URL(path, "http://127.0.0.1");
  const query = input.query && typeof input.query === "object" && !Array.isArray(input.query)
    ? input.query
    : input;
  for (const queryParam of operation.http?.query || []) {
    const aliases = [queryParam.name, ...(queryParam.aliases || [])];
    const value = aliases.map((alias) => query[alias]).find(
      (item) => item !== undefined && item !== null && item !== ""
    );
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(queryParam.name, String(value));
    }
  }
  const method = String(operation.http?.method || "POST").toUpperCase();
  const requestBody = method === "GET" || method === "HEAD"
    ? Buffer.alloc(0)
    : Buffer.from(JSON.stringify(body && typeof body === "object" ? body : {}), "utf8");
  return { url, requestBody, params };
}

const TOKEN_LIKE_SUMMARY_KEY_NORMALIZED = new Set([
  "authorization",
  "auth",
  "bearer",
  "token",
  "apikey",
  "xapikey",
  "secret",
  "clientsecret",
  "password",
  "credential",
  "credentials",
  "accesstoken",
  "refreshtoken",
  "idtoken"
]);

const TOKEN_LIKE_SUMMARY_VALUE_PATTERNS = [
  /\bAuthorization\s*[:=]\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/i,
  /\b(?:api[-_\s]?key|apikey|access[-_\s]?token|refresh[-_\s]?token|id[-_\s]?token|token|secret)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}/i,
  /(?:^|[?&\s])(?:api[_-]?key|access_token|refresh_token|id_token|token|secret)=["']?[^&\s"']{6,}/i,
  /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|ghr|xoxb|xoxp|ya29)[A-Za-z0-9._-]{10,}\b/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/
];

function normalizedSummaryKey(value = "") {
  return String(value || "").replace(/[-_\s.]/g, "").toLowerCase();
}

function isTokenLikeSummaryKey(value = "") {
  const normalized = normalizedSummaryKey(value);
  return TOKEN_LIKE_SUMMARY_KEY_NORMALIZED.has(normalized) ||
    normalized.endsWith("token") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("password") ||
    normalized.endsWith("credential");
}

function isTokenLikeSummaryString(value = "") {
  const text = String(value || "");
  return TOKEN_LIKE_SUMMARY_VALUE_PATTERNS.some((pattern) => pattern.test(text));
}

function safeSummaryKey(key = "", { redactTokenLikeValues = false } = {}) {
  const text = String(key || "");
  if (!redactTokenLikeValues) {
    return text;
  }
  return isTokenLikeSummaryKey(text) || isTokenLikeSummaryString(text)
    ? "[redacted-key]"
    : text;
}

function safeSummaryPathSegment(segment = "", { sensitive = false } = {}) {
  const text = String(segment || "");
  if (sensitive || isTokenLikeSummaryKey(text) || isTokenLikeSummaryString(text)) {
    return "<redacted-key>";
  }
  const cleaned = text.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  return cleaned || "field";
}

function tokenLikeSummaryEvidence(value, { path = "result", reason = "token_like_result_value" } = {}) {
  return {
    path,
    reason,
    valueType: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
    fingerprint: crypto.createHash("sha256").update(String(value ?? "")).digest("hex")
  };
}

function collectTokenLikeSummaryEvidence(value, {
  path = ["result"],
  inheritedSensitiveKey = false,
  evidence = [],
  seen = new WeakSet()
} = {}) {
  if (evidence.length >= 20) {
    return evidence;
  }
  if (typeof value === "string") {
    if (inheritedSensitiveKey || isTokenLikeSummaryString(value)) {
      evidence.push(tokenLikeSummaryEvidence(value, {
        path: path.join("."),
        reason: inheritedSensitiveKey ? "sensitive_result_key" : "token_like_result_value"
      }));
    }
    return evidence;
  }
  if (!value || typeof value !== "object") {
    return evidence;
  }
  if (seen.has(value)) {
    return evidence;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      collectTokenLikeSummaryEvidence(item, {
        path: path.concat(`[${index}]`),
        inheritedSensitiveKey,
        evidence,
        seen
      });
      if (evidence.length >= 20) {
        break;
      }
    }
    return evidence;
  }
  for (const [key, entryValue] of Object.entries(value)) {
    const keySensitive = isTokenLikeSummaryKey(key) || isTokenLikeSummaryString(key);
    collectTokenLikeSummaryEvidence(entryValue, {
      path: path.concat(safeSummaryPathSegment(key, { sensitive: keySensitive })),
      inheritedSensitiveKey: inheritedSensitiveKey || keySensitive,
      evidence,
      seen
    });
    if (evidence.length >= 20) {
      break;
    }
  }
  return evidence;
}

function tokenLikeSummaryRedaction(value, options = {}) {
  if (!options.redactTokenLikeValues) {
    return null;
  }
  const evidence = collectTokenLikeSummaryEvidence(value);
  if (!evidence.length) {
    return null;
  }
  return {
    decision: "redacted",
    reason: "token_like_result_value",
    redactedValueCount: evidence.length,
    evidence: evidence.slice(0, 8),
    evidenceTruncated: evidence.length > 8
  };
}

function outputGovernanceRedactionSummary(redaction = null) {
  if (!redaction || typeof redaction !== "object" || Array.isArray(redaction)) {
    return null;
  }
  return {
    decision: String(redaction.decision || "redacted"),
    reason: String(redaction.reason || "token_like_result_value"),
    redactedValueCount: Math.max(0, Number(redaction.redactedValueCount || 0) || 0),
    evidenceCount: Array.isArray(redaction.evidence) ? redaction.evidence.length : 0,
    evidenceTruncated: redaction.evidenceTruncated === true
  };
}

function resultSummaryFromPayload(payload, options = {}) {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const result = payload.result !== undefined ? payload.result : payload;
  const redaction = tokenLikeSummaryRedaction(result, options);
  if (Array.isArray(result)) {
    return {
      type: "array",
      length: result.length,
      ...(redaction ? { redaction } : {})
    };
  }
  if (result && typeof result === "object") {
    return {
      type: "object",
      keys: Object.keys(result).slice(0, 40).map((key) => safeSummaryKey(key, options)),
      ...(redaction ? { redaction } : {})
    };
  }
  return redaction
    ? { value: "[redacted]", redaction }
    : { value: result };
}

function statusClassFromCode(statusCode = 0) {
  const code = Number(statusCode || 0);
  if (!Number.isFinite(code) || code <= 0) {
    return "unknown";
  }
  return `${Math.floor(code / 100)}xx`;
}

function secretRefFingerprint(operation = {}) {
  const secretRef = String(operation.externalMcp?.upstream?.auth?.secretRef || "").trim();
  if (!secretRef) {
    return "";
  }
  return crypto.createHash("sha256").update(secretRef).digest("hex");
}

function externalEgressDecisionSummary(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { decision: "delegated_to_servicehub_runtime" };
  }
  const dns = value.dns && typeof value.dns === "object" && !Array.isArray(value.dns)
    ? value.dns
    : null;
  return {
    decision: value.ok === false ? "denied" : "allowed",
    schemaVersion: String(value.schemaVersion || ""),
    label: String(value.label || ""),
    protocol: String(value.protocol || ""),
    host: String(value.host || ""),
    port: String(value.port || ""),
    hostKind: String(value.hostKind || ""),
    addressCategory: String(value.addressCategory || ""),
    reason: String(value.reason || ""),
    allowLocalForDevelopment: value.allowLocalForDevelopment === true,
    ...(dns ? {
      dns: {
        status: String(dns.status || ""),
        host: String(dns.host || ""),
        addressCount: Math.max(0, Number(dns.addressCount || 0) || 0),
        restrictedAddressCount: Math.max(0, Number(dns.restrictedAddressCount || 0) || 0),
        addressCategories: sortedStrings(dns.addressCategories),
        restrictedAddressCategories: sortedStrings(dns.restrictedAddressCategories)
      }
    } : {})
  };
}

function externalOutputGovernanceDecision({
  operation = {},
  externalResult = null,
  resultBytes = 0,
  maxResultBytes = 0,
  resultSummaryRedaction = null
} = {}) {
  const upstreamType = String(operation.externalMcp?.upstream?.type || externalResult?.upstream?.type || "").trim();
  const result = externalResult?.result;
  const redaction = outputGovernanceRedactionSummary(resultSummaryRedaction);
  const decision = {
    decision: "passed",
    mode: "summary_only",
    resultBytes: Math.max(0, Number(resultBytes || 0) || 0),
    maxResultBytes: Math.max(0, Number(maxResultBytes || 0) || 0),
    ...(redaction ? { redaction } : {})
  };
  if (upstreamType !== "mcp" || !result || typeof result !== "object" || Array.isArray(result)) {
    return { ok: true, decision };
  }
  const content = Array.isArray(result.content) ? result.content : [];
  const blockedTypes = sortedStrings(content
    .map((item) => String(item?.type || "").trim())
    .filter((type) => type && !["text"].includes(type)));
  if (!blockedTypes.length) {
    return { ok: true, decision: { ...decision, mcpContentTypes: sortedStrings(content.map((item) => item?.type).filter(Boolean)) } };
  }
  return {
    ok: false,
    errorCode: "output_governance_blocked",
    statusCode: 422,
    message: "External MCP tool result contains content types that require governed asset/ref handling before exposure.",
    decision: {
      ...decision,
      decision: "blocked",
      reason: "unsupported_mcp_content_type",
      blockedContentTypes: blockedTypes
    }
  };
}

function grantProjectionFingerprint(grant = {}, catalogFingerprint = "") {
  const explicit = String(grant.projectionFingerprint || grant.projection?.fingerprint || "").trim();
  if (explicit) {
    return explicit;
  }
  const metadata = grant.metadata && typeof grant.metadata === "object" && !Array.isArray(grant.metadata)
    ? grant.metadata
    : {};
  return fingerprintValue({
    protocolVersion: "v0.0.1:tool:grant-projection-1",
    grantId: String(grant.id || ""),
    type: String(grant.type || ""),
    enabled: grant.enabled !== false,
    toolsets: sortedStrings(grant.toolsets),
    toolAllow: sortedStrings(grant.toolAllow),
    toolDeny: sortedStrings(grant.toolDeny),
    scopes: sortedStrings(grant.scopes),
    allowedOrigins: sortedStrings(grant.allowedOrigins),
    allowedCidrs: sortedStrings(grant.allowedCidrs),
    maxUses: grant.maxUses === null || grant.maxUses === undefined ? null : Number(grant.maxUses || 0),
    rateLimit: grant.rateLimit && typeof grant.rateLimit === "object" && !Array.isArray(grant.rateLimit)
      ? { perMinute: Math.max(0, Number(grant.rateLimit.perMinute || 0) || 0) }
      : {},
    policyRevision: Math.max(0, Number(metadata.policyRevision || 0) || 0),
    credentialProtocol: String(metadata.credentialProtocol || ""),
    credentialId: String(metadata.credentialId || ""),
    catalogFingerprint: String(catalogFingerprint || grant.projection?.catalogFingerprint || "").trim()
  });
}

function externalCallReceipt({
  toolExecutionId,
  traceId,
  tool = {},
  operation = {},
  authorization = {},
  context = {},
  policySummary = {},
  status = "ok",
  errorCode = "",
  durationMs = 0,
  resultBytes = 0,
  upstreamStatusCode = 0,
  externalResult = null,
  catalogFingerprint = "",
  outputGovernance = null,
  egressDecision = null
} = {}) {
  const upstream = operation.externalMcp?.upstream && typeof operation.externalMcp.upstream === "object"
    ? operation.externalMcp.upstream
    : {};
  const externalMcp = operation.externalMcp && typeof operation.externalMcp === "object"
    ? operation.externalMcp
    : {};
  const adoption = externalMcp.adoption && typeof externalMcp.adoption === "object"
    ? externalMcp.adoption
    : {};
  const grant = authorization.grant || {};
  const toolFingerprint = String(externalMcp.toolFingerprint || adoption.fingerprint || "").trim();
  const catalogBindingFingerprint = String(externalMcp.catalogBindingFingerprint || "").trim();
  const globalCatalogFingerprint = String(catalogFingerprint || externalMcp.catalogFingerprint || externalMcp.serviceCatalogFingerprint || "").trim();
  const manifestId = String(externalMcp.manifestId || "").trim();
  const manifestFingerprint = String(externalMcp.manifestFingerprint || "").trim();
  const serviceCatalogVersionId = String(externalMcp.serviceCatalogVersionId || externalMcp.activeVersionId || "").trim();
  const resolvedGrantProjectionFingerprint = grantProjectionFingerprint(grant, globalCatalogFingerprint);
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: "v0.0.1:external-service:servicehub-external-call-receipt-1",
    toolExecutionId,
    traceId,
    serviceId: String(externalMcp.serviceId || externalResult?.serviceId || ""),
    upstreamToolName: String(externalMcp.upstreamToolName || externalResult?.upstreamToolName || ""),
    toolId: String(tool.id || ""),
    operationId: String(tool.operationId || operation.id || ""),
    toolVersion: String(tool.version || ""),
    toolsetIds: Array.isArray(tool.toolsets) ? tool.toolsets : [],
    catalogVersion: globalCatalogFingerprint || catalogBindingFingerprint,
    catalogFingerprint: globalCatalogFingerprint,
    catalogBindingFingerprint,
    manifestId,
    manifestFingerprint,
    serviceCatalogVersionId,
    activeVersionId: String(externalMcp.activeVersionId || serviceCatalogVersionId).trim(),
    serviceFingerprint: String(externalMcp.serviceFingerprint || "").trim(),
    discoveredAt: String(externalMcp.discoveredAt || "").trim(),
    toolAdoption: {
      protocolVersion: String(adoption.protocolVersion || ""),
      state: String(adoption.state || ""),
      fingerprint: toolFingerprint,
      currentToolFingerprint: String(externalMcp.currentToolFingerprint || "").trim(),
      previousFingerprint: String(adoption.previousFingerprint || "").trim(),
      reasonCode: String(adoption.reasonCode || "").trim(),
      discoveredAt: String(adoption.discoveredAt || externalMcp.discoveredAt || "").trim(),
      adoptedAt: String(adoption.adoptedAt || "").trim(),
      adoptedBy: String(adoption.adoptedBy || "").trim()
    },
    grantId: String(grant.id || ""),
    grantProjectionFingerprint: resolvedGrantProjectionFingerprint,
    subject: {
      type: "grant",
      agentId: String(context.agentId || context.agentProfileId || ""),
      profileId: String(context.profileId || context.agentProfileId || ""),
      tenantId: String(context.tenantId || ""),
      workspaceId: String(context.workspaceId || "")
    },
    risk: String(tool.risk || operation.safety?.risk || ""),
    serviceProtocolVersion: String(externalResult?.protocolVersion || ""),
    upstream: {
      type: String(upstream.type || externalResult?.upstream?.type || ""),
      transport: String(upstream.transport || externalResult?.upstream?.transport || ""),
      endpointRedacted: true
    },
    decisions: {
      policy: policySummary,
      egress: externalEgressDecisionSummary(egressDecision || externalResult?.egressDecision),
      mappingSandbox: { decision: "manifest_bound" },
      outboundGovernance: { decision: "summary_only" },
      quotaBulkhead: { decision: "tool_concurrency_applied" },
      errorTaxonomy: { decision: errorCode ? "normalized_error_code" : "not_applicable", errorCode },
      reconciliation: { decision: "not_configured" },
      streamingBackpressure: { decision: "non_streaming_result" },
      outputGovernance: outputGovernance && typeof outputGovernance === "object" && !Array.isArray(outputGovernance)
        ? outputGovernance
        : { decision: "summary_only" }
    },
    deadline: {
      timeoutMs: Math.max(0, Number(tool.timeoutMs || 0) || 0),
      durationMs: Math.max(0, Number(durationMs || 0) || 0)
    },
    retry: {
      attempt: 1,
      retryApplied: false
    },
    circuit: {
      state: "not_recorded"
    },
    upstreamStatusClass: upstreamStatusCode ? statusClassFromCode(upstreamStatusCode) : (status === "ok" ? "success" : "unknown"),
    resultBytes: Math.max(0, Number(resultBytes || 0) || 0),
    secretRefFingerprint: secretRefFingerprint(operation),
    unknownOutcome: ["tool_timeout", "AbortError"].includes(String(errorCode || "")),
    recoveryStatus: "not_required",
    assetRefs: [],
    redaction: {
      rawUrlQuery: "omitted",
      headers: "omitted",
      requestBody: "omitted",
      responseBody: "omitted",
      secrets: "omitted",
      stackTrace: "omitted",
      internalPaths: "omitted"
    },
    auditRef: {
      kind: "tool_execution",
      id: toolExecutionId
    },
    status
  };
}

function jsonByteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  } catch {
    return 0;
  }
}

function schemaTypeList(schema = {}) {
  const rawType = schema.type;
  if (Array.isArray(rawType)) {
    return rawType.map((type) => String(type || "").trim()).filter(Boolean);
  }
  const type = String(rawType || "").trim();
  if (type) {
    return [type];
  }
  if (schema.properties) {
    return ["object"];
  }
  if (schema.items) {
    return ["array"];
  }
  return [];
}

function jsonSchemaValueEquals(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return left === right;
  }
}

const SAFE_JSON_SCHEMA_PATTERN_MAX_LENGTH = 160;

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

function validateInputValueAgainstSchema({
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
      error: `Tool operation ${operationId} ${path} must be ${types.join(" or ")}.`
    };
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => jsonSchemaValueEquals(item, value))) {
    return {
      ok: false,
      error: `Tool operation ${operationId} ${path} must be one of the declared enum values.`
    };
  }
  if (Object.prototype.hasOwnProperty.call(schema, "const") && !jsonSchemaValueEquals(schema.const, value)) {
    return {
      ok: false,
      error: `Tool operation ${operationId} ${path} must match the declared const value.`
    };
  }
  for (const [index, subschema] of jsonSchemaSubschemas(schema, "allOf").entries()) {
    const validation = validateInputValueAgainstSchema({
      operationId,
      schema: subschema,
      value,
      path
    });
    if (!validation.ok) {
      return {
        ok: false,
        error: `Tool operation ${operationId} ${path} must satisfy allOf[${index}]: ${validation.error}`
      };
    }
  }
  const anyOf = jsonSchemaSubschemas(schema, "anyOf");
  if (anyOf.length) {
    const matched = anyOf.some((subschema) => validateInputValueAgainstSchema({
      operationId,
      schema: subschema,
      value,
      path
    }).ok);
    if (!matched) {
      return {
        ok: false,
        error: `Tool operation ${operationId} ${path} must satisfy at least one anyOf schema.`
      };
    }
  }
  const oneOf = jsonSchemaSubschemas(schema, "oneOf");
  if (oneOf.length) {
    const matchCount = oneOf.filter((subschema) => validateInputValueAgainstSchema({
      operationId,
      schema: subschema,
      value,
      path
    }).ok).length;
    if (matchCount !== 1) {
      return {
        ok: false,
        error: `Tool operation ${operationId} ${path} must satisfy exactly one oneOf schema.`
      };
    }
  }
  if (schema.not && typeof schema.not === "object" && !Array.isArray(schema.not)) {
    const validation = validateInputValueAgainstSchema({
      operationId,
      schema: schema.not,
      value,
      path
    });
    if (validation.ok) {
      return {
        ok: false,
        error: `Tool operation ${operationId} ${path} must not match the declared not schema.`
      };
    }
  }
  if (typeof value === "string") {
    const length = value.length;
    const minLength = Number(schema.minLength);
    const maxLength = Number(schema.maxLength);
    if (Number.isFinite(minLength) && length < minLength) {
      return {
        ok: false,
        error: `Tool operation ${operationId} ${path} must be at least ${minLength} characters.`
      };
    }
    if (Number.isFinite(maxLength) && length > maxLength) {
      return {
        ok: false,
        error: `Tool operation ${operationId} ${path} must be at most ${maxLength} characters.`
      };
    }
    if (Object.prototype.hasOwnProperty.call(schema, "pattern")) {
      const patternValidation = validateSafeJsonSchemaPattern(schema.pattern);
      if (!patternValidation.ok) {
        return {
          ok: false,
          error: `Tool operation ${operationId} ${path} uses unsupported pattern: ${patternValidation.error}.`
        };
      }
      if (!patternValidation.regex.test(value)) {
        return {
          ok: false,
          error: `Tool operation ${operationId} ${path} must match the declared pattern.`
        };
      }
    }
    if (schema.format) {
      const formatValidation = stringMatchesJsonSchemaFormat(value, schema.format);
      if (formatValidation.unsupported) {
        return {
          ok: false,
          error: `Tool operation ${operationId} ${path} uses unsupported string format: ${formatValidation.format}.`
        };
      }
      if (!formatValidation.ok) {
        return {
          ok: false,
          error: `Tool operation ${operationId} ${path} must match format ${String(schema.format).trim()}.`
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
        error: `Tool operation ${operationId} ${path} must be at least ${minimum}.`
      };
    }
    if (Number.isFinite(maximum) && value > maximum) {
      return {
        ok: false,
        error: `Tool operation ${operationId} ${path} must be at most ${maximum}.`
      };
    }
  }
  if (Array.isArray(value)) {
    const minItems = Number(schema.minItems);
    const maxItems = Number(schema.maxItems);
    if (Number.isFinite(minItems) && value.length < minItems) {
      return {
        ok: false,
        error: `Tool operation ${operationId} ${path} must contain at least ${minItems} items.`
      };
    }
    if (Number.isFinite(maxItems) && value.length > maxItems) {
      return {
        ok: false,
        error: `Tool operation ${operationId} ${path} must contain at most ${maxItems} items.`
      };
    }
    if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
      for (let index = 0; index < value.length; index += 1) {
        const itemValidation = validateInputValueAgainstSchema({
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
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (value[key] === undefined || value[key] === null || value[key] === "") {
        return {
          ok: false,
          error: `Tool operation ${operationId} missing required input: ${path}.${key}.`
        };
      }
    }
    const maxProperties = Number(schema.maxProperties);
    if (Number.isFinite(maxProperties) && Object.keys(value).length > maxProperties) {
      return {
        ok: false,
        error: `Tool operation ${operationId} ${path} must contain at most ${maxProperties} properties.`
      };
    }
    for (const [key, entryValue] of Object.entries(value)) {
      const propertySchema = properties[key];
      if (!propertySchema) {
        if (schema.additionalProperties === false) {
          return {
            ok: false,
            error: `Tool operation ${operationId} received undeclared input: ${path}.${key}.`
          };
        }
        if (schema.additionalProperties && typeof schema.additionalProperties === "object" && !Array.isArray(schema.additionalProperties)) {
          const additionalValidation = validateInputValueAgainstSchema({
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
      const propertyValidation = validateInputValueAgainstSchema({
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

function validateInputSchema(operation, input = {}) {
  const schema = operation.inputSchema || {};
  const topLevelTypes = schemaTypeList(schema);
  if (topLevelTypes.length && !topLevelTypes.includes("object")) {
    return { ok: true };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      error: `Tool operation ${operation.id} requires object input.`
    };
  }
  for (const key of schema.required || []) {
    if (input[key] === undefined || input[key] === null || input[key] === "") {
      return {
        ok: false,
        error: `Tool operation ${operation.id} missing required input: ${key}.`
      };
    }
  }
  const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
    ? schema.properties
    : {};
  if (schema.additionalProperties === false) {
    const extraKeys = Object.keys(input).filter((key) => !Object.prototype.hasOwnProperty.call(properties, key));
    if (extraKeys.length) {
      return {
        ok: false,
        error: `Tool operation ${operation.id} received undeclared input: ${extraKeys.sort().join(", ")}.`
      };
    }
  }
  return validateInputValueAgainstSchema({
    operationId: operation.id,
    schema,
    value: input,
    path: "input"
  });
}

function timeoutError(timeoutMs) {
  const error = new Error(`Tool execution timed out after ${timeoutMs}ms.`);
  error.code = "tool_timeout";
  return error;
}

async function withTimeout(promise, timeoutMs) {
  const normalizedTimeout = Math.max(1, Number(timeoutMs || 30_000));
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(normalizedTimeout)), normalizedTimeout);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function createToolExecutionRuntime({
  registry,
  store,
  policyEngine,
  securityPermissions = null,
  operations = [],
  externalMcpPassthroughRuntime = null,
  controllers,
  operationAuditStore = null,
  operationConcurrencyScope = "tool-management",
  protocolEventBus = null,
  logger = getRuntimeLogger()
}) {
  let operationsById = new Map(operations.map((operation) => [operation.id, operation]));
  const toolLocks = new Map();

  function refreshOperations(nextOperations = []) {
    operationsById = new Map(nextOperations.map((operation) => [operation.id, operation]));
    return { ok: true, operationCount: operationsById.size };
  }

  function currentCatalogFingerprint() {
    try {
      return String(registry?.getCatalog?.().fingerprint || "").trim();
    } catch {
      return "";
    }
  }

  function appendAuthorizationDecision(decision = {}) {
    if (!securityPermissions || typeof securityPermissions.appendDecision !== "function") {
      return;
    }
    securityPermissions.appendDecision({
      protocolVersion: "v0.0.1:risk-control:authorization-1",
      allowed: false,
      effect: "deny",
      evaluatedLayers: ["tool_token_authorization"],
      createdAt: nowIso(),
      ...decision
    });
  }

  function logTool(level, event, details = {}) {
    if (!logger || typeof logger[level] !== "function") {
      return;
    }
    logger[level](event, details);
  }

  async function withToolConcurrency(tool, run) {
    if (tool.concurrencySafe) {
      logTool("debug", "tool_management.concurrency.bypassed", {
        toolId: tool.id,
        reason: "concurrency_safe"
      });
      return run();
    }
    const key = tool.id;
    const previous = toolLocks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    const chained = previous.catch(() => null).then(() => current);
    toolLocks.set(key, chained);
    try {
      logTool("debug", "tool_management.concurrency.waiting", {
        toolId: tool.id,
        queueDepth: toolLocks.size
      });
      await previous.catch(() => null);
      logTool("debug", "tool_management.concurrency.acquired", {
        toolId: tool.id
      });
      return await run();
    } finally {
      release();
      if (toolLocks.get(key) === chained) {
        toolLocks.delete(key);
      }
      logTool("debug", "tool_management.concurrency.released", {
        toolId: tool.id,
        remainingLocks: toolLocks.size
      });
    }
  }

  async function publishEvent(topic, payload, options = {}) {
    if (!protocolEventBus || typeof protocolEventBus.publish !== "function") {
      return;
    }
    await protocolEventBus.publish(topic, payload, options).catch(() => {});
  }

  async function executeTool({
    toolId,
    input = {},
    request,
    context = {},
    dryRun = false,
    directOperation = null,
    directUrl = null,
  directRequestBody = null,
  directParams = null,
  authorizedGrant = null,
  approvedPendingOperation = null
  } = {}) {
    const trustedApproval = trustedApprovedPendingOperation(approvedPendingOperation);
    const requestTrace = traceContextFromRequest(request);
    const traceId = context.traceId || requestTrace?.traceId || randomId("trace");
    const toolExecutionId = randomId("tool_exec");
    const startedAtMs = Date.now();
    const startedAt = nowIso();
    const inputBytes = jsonByteLength(input);
    const tool = registry.getTool(toolId);
    const operation = directOperation || operationsById.get(tool?.operationId || "");
    const profile = context.profileId
      ? registry.listProfiles().find((item) => item.id === context.profileId)
      : null;
    const relayChildOperation = context.relayChildOperation && typeof context.relayChildOperation === "object" && !Array.isArray(context.relayChildOperation)
      ? context.relayChildOperation
      : null;
    const appendExecution = (entry = {}) => store.appendExecution({
      ...entry,
      ...(relayChildOperation ? { relayChildOperation } : {})
    });

    if (!tool || !operation) {
      logTool("warn", "tool_management.execute.denied", {
        traceId,
        toolExecutionId,
        toolId: toolId || "",
        reason: tool ? "operation_missing" : "unknown_tool",
        input: summarizeForLog(input)
      });
      const status = tool ? 500 : 404;
      const reasonCode = tool ? "operation_missing" : "unknown_tool";
      appendExecution({
        toolExecutionId,
        traceId,
        toolId: toolId || "",
        status: "denied",
        errorCode: reasonCode,
        decision: "deny",
        input,
        startedAt,
        finishedAt: nowIso()
      });
      store.appendMetric({ traceId, toolId, status: "denied", reasonCode, inputBytes });
      appendAuthorizationDecision({
        decisionId: randomId("authz_decision"),
        traceId,
        toolExecutionId,
        toolId: toolId || "",
        operationId: tool?.operationId || "",
        reasonCode,
        redactedReason: tool ? "Tool operation is not available." : "Tool is not registered.",
        subject: {
          type: "anonymous",
          subjectId: "",
          scopes: []
        },
        resource: {
          toolId: toolId || "",
          operationId: tool?.operationId || "",
          risk: tool?.risk || ""
        }
      });
      return {
        ok: false,
        status,
        payload: {
          schemaVersion: "v0.0.1:schema:definition-1",
          traceId,
          error: {
            code: reasonCode,
            message: tool ? "Tool operation is not available." : "Tool is not registered.",
            details: { toolId }
          }
        }
      };
    }

    logTool("info", "tool_management.execute.started", {
      traceId,
      toolExecutionId,
      toolId: tool.id,
      operationId: tool.operationId,
      risk: tool.risk,
      dryRun,
      input: summarizeForLog(input),
      context: summarizeForLog(context)
    });
    await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status: "started" }, { type: "tools.execution.started" });

    const authorization = authorizedGrant
      ? {
          ok: true,
          grant: authorizedGrant,
          sourceIp: trustedApproval?.sourceIp || sourceIpFromRequest(request)
        }
      : await store.authorizeRequest({
          request,
          requiredScopes: tool.requiredScopes,
          tool,
          context
        });
    if (!authorization.ok) {
      const durationMs = Date.now() - startedAtMs;
      logTool("warn", "tool_management.execute.denied", {
        traceId,
        toolExecutionId,
        toolId: tool.id,
        operationId: tool.operationId,
        risk: tool.risk,
        reason: authorization.reasonCode || "authorization_denied",
        durationMs
      });
      const decision = {
        effect: "deny",
        reasonCode: authorization.reasonCode || "authorization_denied",
        decisionId: randomId("policy")
      };
      store.appendPolicyDecision({
        ...decision,
        toolExecutionId,
        traceId,
        toolId: tool.id,
        grantId: authorization.grant?.id || "",
        missingScopes: authorization.missingScopes || []
      });
      appendAuthorizationDecision({
        ...decision,
        traceId,
        toolExecutionId,
        toolId: tool.id,
        operationId: tool.operationId,
        grantId: authorization.grant?.id || "",
        subject: authorization.grant
          ? {
              type: "tool-grant",
              subjectId: authorization.grant.id,
              username: authorization.grant.label || authorization.grant.id,
              scopes: authorization.grant.scopes || [],
              capabilities: authorization.grant.capabilities || []
            }
          : {
              type: "anonymous",
              subjectId: "",
              scopes: [],
              capabilities: []
            },
        resource: {
          toolId: tool.id,
          operationId: tool.operationId,
          risk: tool.risk
        },
        missingScopes: authorization.missingScopes || [],
        missingCapabilities: authorization.missingCapabilities || [],
        redactedReason: authorization.error || "Tool token authorization denied."
      });
      appendExecution({
        toolExecutionId,
        traceId,
        toolId: tool.id,
        toolVersion: tool.version,
        toolsetIds: tool.toolsets,
        subjectType: "grant",
        subjectId: authorization.grant?.id || "",
        grantId: authorization.grant?.id || "",
        agentId: context.agentId || "",
        profileId: context.profileId || "",
        operationId: tool.operationId,
        risk: tool.risk,
        decision: "deny",
        input,
        status: "denied",
        errorCode: decision.reasonCode,
        durationMs,
        policyDecisionId: decision.decisionId,
        sourceIp: sourceIpFromRequest(request),
        userAgent: request?.headers?.["user-agent"] || "",
        startedAt,
        finishedAt: nowIso()
      });
      store.appendMetric({
        traceId,
        toolId: tool.id,
        grantId: authorization.grant?.id || "",
        profileId: context.profileId || "",
        status: "denied",
        risk: tool.risk,
        durationMs,
        inputBytes,
        reasonCode: decision.reasonCode
      });
      await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status: "denied" }, { type: "tools.execution.denied" });
      return {
        ok: false,
        status: authorization.status || 403,
        payload: {
          schemaVersion: "v0.0.1:schema:definition-1",
          traceId,
          error: {
            code: decision.reasonCode,
            message: authorization.error || "Tool call denied.",
            details: {
              missingScopes: authorization.missingScopes || [],
              missingCapabilities: authorization.missingCapabilities || []
            }
          }
        }
      };
    }

    const policy = policyEngine.evaluate({
      tool,
      grant: authorization.grant,
      profile,
      input,
      request,
      context,
      dryRun,
      traceId,
      toolExecutionId
    });

    // Approval proof must come from resumePendingOperation's internal parameter, never caller context.
    const approvalAlreadyGranted = Boolean(trustedApproval);
    const policySummary = policyRevisionSummary(policy);
    async function denyInvalidInput(schemaValidation) {
      const durationMs = Date.now() - startedAtMs;
      logTool("warn", "tool_management.execute.denied", {
        traceId,
        toolExecutionId,
        toolId: tool.id,
        operationId: tool.operationId,
        risk: tool.risk,
        reason: "invalid_input",
        error: schemaValidation.error,
        durationMs
      });
      appendExecution({
        toolExecutionId,
        traceId,
        toolId: tool.id,
        toolVersion: tool.version,
        toolsetIds: tool.toolsets,
        subjectType: "grant",
        subjectId: authorization.grant.id,
        grantId: authorization.grant.id,
        agentId: context.agentId || "",
        profileId: context.profileId || "",
        operationId: tool.operationId,
        risk: tool.risk,
        decision: policy.effect,
        input,
        resultSummary: {
          type: "invalid_input",
          error: schemaValidation.error,
          policy: policySummary
        },
        status: "denied",
        errorCode: "invalid_input",
        durationMs,
        policyDecisionId: policy.decisionId,
        sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
        userAgent: request?.headers?.["user-agent"] || "",
        startedAt,
        finishedAt: nowIso()
      });
      store.appendMetric({
        traceId,
        toolId: tool.id,
        grantId: authorization.grant.id,
        profileId: context.profileId || "",
        status: "denied",
        risk: tool.risk,
        durationMs,
        inputBytes,
        reasonCode: "invalid_input"
      });
      await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status: "denied" }, { type: "tools.execution.denied" });
      return {
        ok: false,
        status: 400,
        payload: {
          schemaVersion: "v0.0.1:schema:definition-1",
          traceId,
          error: {
            code: "invalid_input",
            message: schemaValidation.error,
            details: {
              toolExecutionId,
              decisionId: policy.decisionId,
              policy: policySummary
            }
          }
        }
      };
    }
    const pendingApprovalRequired = tool.requiresApproval === true;
    if (
      !dryRun &&
      policy.effect !== "dry_run_only" &&
      ["allow", "require_confirmation"].includes(policy.effect) &&
      pendingApprovalRequired &&
      !approvalAlreadyGranted
    ) {
      const durationMs = Date.now() - startedAtMs;
      const pendingOperation = store.createPendingOperation({
        traceId,
        toolExecutionId,
        toolId: tool.id,
        toolVersion: tool.version,
        toolsetIds: tool.toolsets,
        operationId: tool.operationId,
        risk: tool.risk,
        approvalScope: tool.approvalScope || operation.safety?.approvalScope || "",
        grantId: authorization.grant.id,
        agentId: context.agentId || context.agentProfileId || "",
        profileId: context.profileId || context.agentProfileId || "",
        idempotencyKey: context.idempotencyKey || "",
        reasonCode: "tool_approval_required",
        riskReason: `Tool ${tool.id} requires approval before execution.`,
        originalInput: input,
        context,
        sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
        userAgent: request?.headers?.["user-agent"] || "",
        expiresAt: context.expiresAt || context.approvalExpiresAt || ""
      });
      appendExecution({
        toolExecutionId,
        traceId,
        toolId: tool.id,
        toolVersion: tool.version,
        toolsetIds: tool.toolsets,
        subjectType: "grant",
        subjectId: authorization.grant.id,
        grantId: authorization.grant.id,
        agentId: context.agentId || "",
        profileId: context.profileId || "",
        operationId: tool.operationId,
        risk: tool.risk,
        decision: policy.effect,
        input,
        resultSummary: {
          type: "pending_operation",
          pendingOperationId: pendingOperation.pendingOperationId,
          status: pendingOperation.status,
          policy: policySummary
        },
        status: "pending_approval",
        errorCode: "tool_approval_required",
        durationMs,
        policyDecisionId: policy.decisionId,
        approvalId: pendingOperation.pendingOperationId,
        sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
        userAgent: request?.headers?.["user-agent"] || "",
        startedAt,
        finishedAt: nowIso()
      });
      store.appendMetric({
        traceId,
        toolId: tool.id,
        grantId: authorization.grant.id,
        profileId: context.profileId || "",
        status: "pending_approval",
        risk: tool.risk,
        durationMs,
        inputBytes,
        resultBytes: jsonByteLength(pendingOperation),
        reasonCode: "tool_approval_required"
      });
      await publishEvent("tools.pending_operation", {
        pendingOperationId: pendingOperation.pendingOperationId,
        traceId,
        toolExecutionId,
        toolId: tool.id,
        operationId: tool.operationId,
        risk: tool.risk,
        status: "pending"
      }, { type: "tools.pending_operation.created" });
      return {
        ok: true,
        status: 202,
        payload: {
          schemaVersion: "v0.0.1:schema:definition-1",
          toolExecutionId,
          traceId,
          toolId: tool.id,
          status: "pending_approval",
          pendingOperation,
          policy: policySummary
        }
      };
    }

    if (!["allow", "dry_run_only"].includes(policy.effect)) {
      const durationMs = Date.now() - startedAtMs;
      logTool("warn", "tool_management.execute.denied", {
        traceId,
        toolExecutionId,
        toolId: tool.id,
        operationId: tool.operationId,
        risk: tool.risk,
        reason: policy.reasonCode,
        decisionId: policy.decisionId,
        durationMs
      });
      appendExecution({
        toolExecutionId,
        traceId,
        toolId: tool.id,
        toolVersion: tool.version,
        toolsetIds: tool.toolsets,
        subjectType: "grant",
        subjectId: authorization.grant.id,
        grantId: authorization.grant.id,
        agentId: context.agentId || "",
        profileId: context.profileId || "",
        operationId: tool.operationId,
        risk: tool.risk,
        decision: policy.effect,
        input,
        resultSummary: {
          type: "policy_denial",
          policy: policySummary
        },
        status: "denied",
        errorCode: policy.reasonCode,
        durationMs,
        policyDecisionId: policy.decisionId,
        sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
        userAgent: request?.headers?.["user-agent"] || "",
        startedAt,
        finishedAt: nowIso()
      });
      store.appendMetric({
        traceId,
        toolId: tool.id,
        grantId: authorization.grant.id,
        profileId: context.profileId || "",
        status: "denied",
        risk: tool.risk,
        durationMs,
        inputBytes,
        reasonCode: policy.reasonCode
      });
      await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status: "denied" }, { type: "tools.execution.denied" });
      return {
        ok: false,
        status: policy.effect === "require_confirmation" ? 409 : 403,
        payload: {
          schemaVersion: "v0.0.1:schema:definition-1",
          traceId,
          error: {
            code: policy.reasonCode,
            message: policy.redactedReason,
            details: {
              decisionId: policy.decisionId,
              policy: policySummary,
              missingScopes: policy.missingScopes,
              missingCapabilities: policy.missingCapabilities,
              missingToolsets: policy.missingToolsets
            }
          }
        }
      };
    }

    if (dryRun || policy.effect === "dry_run_only") {
      const durationMs = Date.now() - startedAtMs;
      const result = {
        wouldExecute: true,
        tool: {
          id: tool.id,
          operationId: tool.operationId,
          risk: tool.risk,
          requiredScopes: tool.requiredScopes,
          toolsets: tool.toolsets
        },
        policy
      };
      appendExecution({
        toolExecutionId,
        traceId,
        toolId: tool.id,
        toolVersion: tool.version,
        toolsetIds: tool.toolsets,
        subjectType: "grant",
        subjectId: authorization.grant.id,
        grantId: authorization.grant.id,
        agentId: context.agentId || "",
        profileId: context.profileId || "",
        operationId: tool.operationId,
        risk: tool.risk,
        decision: policy.effect,
        input,
        result,
        status: "ok",
        durationMs,
        policyDecisionId: policy.decisionId,
        sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
        userAgent: request?.headers?.["user-agent"] || "",
        startedAt,
        finishedAt: nowIso()
      });
      store.appendMetric({ traceId, toolId: tool.id, grantId: authorization.grant.id, profileId: context.profileId || "", status: "ok", risk: tool.risk, durationMs, inputBytes, resultBytes: jsonByteLength(result) });
      logTool("info", "tool_management.execute.dry_run_completed", {
        traceId,
        toolExecutionId,
        toolId: tool.id,
        operationId: tool.operationId,
        risk: tool.risk,
        decisionId: policy.decisionId,
        durationMs
      });
      return {
        ok: true,
        status: 200,
        payload: {
          schemaVersion: "v0.0.1:schema:definition-1",
          toolExecutionId,
          traceId,
          toolId: tool.id,
          status: "ok",
          result,
          grant: authorization.grant,
          policy: policySummary
        }
      };
    }

    if (operation.externalMcp?.serviceId && operation.externalMcp?.upstreamToolName) {
      const schemaValidation = validateInputSchema(operation, input);
      if (!schemaValidation.ok) {
        return denyInvalidInput(schemaValidation);
      }
      if (!externalMcpPassthroughRuntime?.callTool) {
        const durationMs = Date.now() - startedAtMs;
        const errorCode = "external_mcp_passthrough_unavailable";
        const receipt = externalCallReceipt({
          toolExecutionId,
          traceId,
          tool,
          operation,
          authorization,
          context,
          policySummary,
          catalogFingerprint: currentCatalogFingerprint(),
          status: "failed",
          errorCode,
          durationMs
        });
        appendExecution({
          toolExecutionId,
          traceId,
          toolId: tool.id,
          toolVersion: tool.version,
          toolsetIds: tool.toolsets,
          subjectType: "grant",
          subjectId: authorization.grant.id,
          grantId: authorization.grant.id,
          agentId: context.agentId || "",
          profileId: context.profileId || "",
          operationId: tool.operationId,
          risk: tool.risk,
          decision: policy.effect,
          input,
          resultSummary: {
            type: "external_mcp_error",
            errorCode,
            serviceId: operation.externalMcp.serviceId,
            upstreamToolName: operation.externalMcp.upstreamToolName,
            externalCallReceipt: receipt,
            policy: policySummary
          },
          status: "failed",
          errorCode,
          durationMs,
          policyDecisionId: policy.decisionId,
          sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
          userAgent: request?.headers?.["user-agent"] || "",
          startedAt,
          finishedAt: nowIso()
        });
        store.appendMetric({
          traceId,
          toolId: tool.id,
          grantId: authorization.grant.id,
          profileId: context.profileId || "",
          status: "failed",
          risk: tool.risk,
          durationMs,
          inputBytes,
          reasonCode: errorCode
        });
        await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status: "failed" }, { type: "tools.execution.failed" });
        return {
          ok: false,
          status: 503,
          payload: {
            schemaVersion: "v0.0.1:schema:definition-1",
            traceId,
            error: {
              code: errorCode,
              message: "External MCP passthrough runtime is unavailable.",
              details: { toolExecutionId }
            }
          }
        };
      }
      try {
        const externalResult = await withToolConcurrency(tool, () =>
          withTimeout(
            externalMcpPassthroughRuntime.callTool({
              serviceId: operation.externalMcp.serviceId,
              toolName: operation.externalMcp.upstreamToolName,
              input,
              timeoutMs: tool.timeoutMs,
              context: {
                tenantId: context.tenantId || "",
                workspaceId: context.workspaceId || "",
                authBindingId: context.authBindingId || context.bindingId || ""
              }
            }),
            tool.timeoutMs
          )
        );
        const result = {
          schemaVersion: "v0.0.1:schema:definition-1",
          protocolVersion: externalResult.protocolVersion || "v0.0.1:external-service:mcp-passthrough-1",
          serviceId: operation.externalMcp.serviceId,
          upstreamToolName: operation.externalMcp.upstreamToolName,
          upstream: externalResult.upstream,
          durationMs: externalResult.durationMs,
          result: externalResult.result
        };
        const resultBytes = jsonByteLength(result);
        const durationMs = Date.now() - startedAtMs;
        const externalResultSummary = resultSummaryFromPayload(result, { redactTokenLikeValues: true });
        const outputGovernance = externalOutputGovernanceDecision({
          operation,
          externalResult,
          resultBytes,
          maxResultBytes: tool.maxResultBytes,
          resultSummaryRedaction: externalResultSummary.redaction || null
        });
        const receipt = externalCallReceipt({
          toolExecutionId,
          traceId,
          tool,
          operation,
          authorization,
          context,
          policySummary,
          catalogFingerprint: currentCatalogFingerprint(),
          status: "ok",
          durationMs,
          resultBytes,
          externalResult,
          outputGovernance: outputGovernance.decision
        });
        if (!outputGovernance.ok) {
          appendExecution({
            toolExecutionId,
            traceId,
            toolId: tool.id,
            toolVersion: tool.version,
            toolsetIds: tool.toolsets,
            subjectType: "grant",
            subjectId: authorization.grant.id,
            grantId: authorization.grant.id,
            agentId: context.agentId || "",
            profileId: context.profileId || "",
            operationId: tool.operationId,
            risk: tool.risk,
            decision: policy.effect,
            input,
            resultSummary: {
              type: "output_governance_blocked",
              errorCode: outputGovernance.errorCode,
              serviceId: operation.externalMcp.serviceId,
              upstreamToolName: operation.externalMcp.upstreamToolName,
              externalCallReceipt: {
                ...receipt,
                status: "failed",
                decisions: {
                  ...receipt.decisions,
                  outputGovernance: outputGovernance.decision,
                  errorTaxonomy: { decision: "normalized_error_code", errorCode: outputGovernance.errorCode }
                },
                unknownOutcome: false
              },
              policy: policySummary
            },
            status: "failed",
            errorCode: outputGovernance.errorCode,
            durationMs,
            policyDecisionId: policy.decisionId,
            sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
            userAgent: request?.headers?.["user-agent"] || "",
            startedAt,
            finishedAt: nowIso()
          });
          store.appendMetric({
            traceId,
            toolId: tool.id,
            grantId: authorization.grant.id,
            profileId: context.profileId || "",
            status: "failed",
            risk: tool.risk,
            durationMs,
            inputBytes,
            resultBytes,
            reasonCode: outputGovernance.errorCode
          });
          await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status: "failed" }, { type: "tools.execution.failed" });
          return {
            ok: false,
            status: outputGovernance.statusCode || 422,
            payload: {
              schemaVersion: "v0.0.1:schema:definition-1",
              traceId,
              error: {
                code: outputGovernance.errorCode,
                message: outputGovernance.message,
                details: {
                  toolExecutionId,
                  blockedContentTypes: outputGovernance.decision.blockedContentTypes || []
                }
              }
            }
          };
        }
        if (resultBytes > Number(tool.maxResultBytes || 0)) {
          appendExecution({
            toolExecutionId,
            traceId,
            toolId: tool.id,
            toolVersion: tool.version,
            toolsetIds: tool.toolsets,
            subjectType: "grant",
            subjectId: authorization.grant.id,
            grantId: authorization.grant.id,
            agentId: context.agentId || "",
            profileId: context.profileId || "",
            operationId: tool.operationId,
            risk: tool.risk,
            decision: policy.effect,
            input,
            resultSummary: {
              type: "oversize",
              byteLength: resultBytes,
              maxResultBytes: tool.maxResultBytes,
              externalCallReceipt: {
                ...receipt,
                status: "failed",
                decisions: {
                  ...receipt.decisions,
                  outputGovernance: { decision: "result_size_limit_exceeded" },
                  errorTaxonomy: { decision: "normalized_error_code", errorCode: "result_too_large" }
                },
                unknownOutcome: false
              },
              policy: policySummary
            },
            status: "failed",
            errorCode: "result_too_large",
            durationMs,
            policyDecisionId: policy.decisionId,
            sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
            userAgent: request?.headers?.["user-agent"] || "",
            startedAt,
            finishedAt: nowIso()
          });
          store.appendMetric({
            traceId,
            toolId: tool.id,
            grantId: authorization.grant.id,
            profileId: context.profileId || "",
            status: "failed",
            risk: tool.risk,
            durationMs,
            inputBytes,
            resultBytes,
            reasonCode: "result_too_large"
          });
          await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status: "failed" }, { type: "tools.execution.failed" });
          return {
            ok: false,
            status: 413,
            payload: {
              schemaVersion: "v0.0.1:schema:definition-1",
              traceId,
              error: {
                code: "result_too_large",
                message: "External MCP tool result exceeds the configured result size limit.",
                details: {
                  toolExecutionId,
                  byteLength: resultBytes,
                  maxResultBytes: tool.maxResultBytes
                }
              }
            }
          };
        }
        appendExecution({
          toolExecutionId,
          traceId,
          toolId: tool.id,
          toolVersion: tool.version,
          toolsetIds: tool.toolsets,
          subjectType: "grant",
          subjectId: authorization.grant.id,
          grantId: authorization.grant.id,
          agentId: context.agentId || "",
          profileId: context.profileId || "",
          operationId: tool.operationId,
          risk: tool.risk,
          decision: policy.effect,
          input,
          resultSummary: {
            type: "external_mcp",
            serviceId: operation.externalMcp.serviceId,
            upstreamToolName: operation.externalMcp.upstreamToolName,
            externalCallReceipt: receipt,
            result: externalResultSummary,
            policy: policySummary
          },
          status: "ok",
          errorCode: "",
          durationMs,
          policyDecisionId: policy.decisionId,
          sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
          userAgent: request?.headers?.["user-agent"] || "",
          startedAt,
          finishedAt: nowIso()
        });
        store.appendMetric({
          traceId,
          toolId: tool.id,
          grantId: authorization.grant.id,
          profileId: context.profileId || "",
          status: "ok",
          risk: tool.risk,
          durationMs,
          inputBytes,
          resultBytes
        });
        await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status: "ok" }, { type: "tools.execution.completed" });
        return {
          ok: true,
          status: 200,
          payload: {
            schemaVersion: "v0.0.1:schema:definition-1",
            toolExecutionId,
            traceId,
            toolId: tool.id,
            status: "ok",
            result,
            grant: authorization.grant,
            policy: policySummary
          }
        };
      } catch (error) {
        const durationMs = Date.now() - startedAtMs;
        const message = error instanceof Error ? error.message : "External MCP tool execution failed.";
        const errorCode = error?.code || "external_mcp_tool_execution_failed";
        const receipt = externalCallReceipt({
          toolExecutionId,
          traceId,
          tool,
          operation,
          authorization,
          context,
          policySummary,
          catalogFingerprint: currentCatalogFingerprint(),
          status: "failed",
          errorCode,
          durationMs,
          upstreamStatusCode: error?.statusCode || 0,
          egressDecision: error?.egressDecision || null
        });
        appendExecution({
          toolExecutionId,
          traceId,
          toolId: tool.id,
          toolVersion: tool.version,
          toolsetIds: tool.toolsets,
          subjectType: "grant",
          subjectId: authorization.grant.id,
          grantId: authorization.grant.id,
          agentId: context.agentId || "",
          profileId: context.profileId || "",
          operationId: tool.operationId,
          risk: tool.risk,
          decision: policy.effect,
          input,
          resultSummary: {
            type: "external_mcp_error",
            errorCode,
            serviceId: operation.externalMcp.serviceId,
            upstreamToolName: operation.externalMcp.upstreamToolName,
            externalCallReceipt: receipt,
            policy: policySummary
          },
          status: "failed",
          errorCode,
          durationMs,
          policyDecisionId: policy.decisionId,
          sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
          userAgent: request?.headers?.["user-agent"] || "",
          startedAt,
          finishedAt: nowIso()
        });
        store.appendMetric({
          traceId,
          toolId: tool.id,
          grantId: authorization.grant.id,
          profileId: context.profileId || "",
          status: "failed",
          risk: tool.risk,
          durationMs,
          inputBytes,
          reasonCode: errorCode
        });
        await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status: "failed" }, { type: "tools.execution.failed" });
        return {
          ok: false,
          status: error?.statusCode || 502,
          payload: {
            schemaVersion: "v0.0.1:schema:definition-1",
            traceId,
            error: {
              code: errorCode,
              message,
              details: {
                toolExecutionId,
                serviceId: operation.externalMcp.serviceId,
                upstreamToolName: operation.externalMcp.upstreamToolName
              }
            }
          }
        };
      }
    }

      const captured = createCapturedResponse();
      const directRequest = directOperation
        ? { url: directUrl, requestBody: directRequestBody, params: directParams || {} }
        : buildDirectOperationRequest({ operation, input });
      const operationInput = {
        ...parseJsonObject(directRequest.requestBody),
        ...(directRequest.params || {})
      };
      const schemaValidation = validateInputSchema(operation, operationInput);
      if (!schemaValidation.ok) {
        return denyInvalidInput(schemaValidation);
    }

    const previousAuthorization = request.__pactToolRuntimeAuthorization;
    request.__pactToolRuntimeAuthorization = {
      ok: true,
      grant: authorization.grant,
      toolExecutionId,
      traceId,
      requiredScopes: tool.requiredScopes
    };
    try {
      const approvalScopes = tool.requiresApproval
        ? [operation.safety?.approvalScope || tool.approvalScope || ""]
        : [];
      const toolActor = {
        type: "tool-grant",
        userId: authorization.grant.id,
        username: authorization.grant.label || authorization.grant.id,
        roleId: "tool-grant",
        scopes: uniqueStrings([
          ...(authorization.grant.scopes || []),
          ...(tool.requiredScopes || []),
          ...(operation.requiredScopes || []),
          ...approvalScopes
        ])
      };
      await withToolConcurrency(tool, () =>
        withTimeout(
          dispatchOperation({
            operation,
            controllers,
            request,
            response: captured,
            requestBody: directRequest.requestBody,
            url: directRequest.url,
            params: directRequest.params,
            input: operationInput,
            transport: "tool-management",
            method: operation.http?.method || "POST",
            authorizeOperation: null,
            operationAuditStore,
            concurrencyScope: operationConcurrencyScope,
            logger,
            authSession: { user: toolActor },
            actor: toolActor,
            skipAuthorization: true
          }),
          tool.timeoutMs
        )
      );
      const buffer = capturedBuffer(captured);
      const statusCode = captured.statusCode || 200;
      const payload = parseCapturedJson(captured);
      const durationMs = Date.now() - startedAtMs;
      if (buffer.length > Number(tool.maxResultBytes || 0)) {
        logTool("error", "tool_management.execute.failed", {
          traceId,
          toolExecutionId,
          toolId: tool.id,
          operationId: tool.operationId,
          risk: tool.risk,
          reason: "result_too_large",
          resultBytes: buffer.length,
          maxResultBytes: tool.maxResultBytes,
          durationMs
        });
        appendExecution({
          toolExecutionId,
          traceId,
          toolId: tool.id,
          toolVersion: tool.version,
          toolsetIds: tool.toolsets,
          subjectType: "grant",
          subjectId: authorization.grant.id,
          grantId: authorization.grant.id,
          agentId: context.agentId || "",
          profileId: context.profileId || "",
          operationId: tool.operationId,
          risk: tool.risk,
          decision: policy.effect,
          input,
          resultSummary: {
            type: "oversize",
            byteLength: buffer.length,
            maxResultBytes: tool.maxResultBytes,
            policy: policySummary
          },
          status: "failed",
          errorCode: "result_too_large",
          durationMs,
          policyDecisionId: policy.decisionId,
          sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
          userAgent: request?.headers?.["user-agent"] || "",
          startedAt,
          finishedAt: nowIso()
        });
        store.appendMetric({
          traceId,
          toolId: tool.id,
          grantId: authorization.grant.id,
          profileId: context.profileId || "",
          status: "failed",
          risk: tool.risk,
          durationMs,
          inputBytes,
          resultBytes: buffer.length,
          reasonCode: "result_too_large"
        });
        await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status: "failed" }, { type: "tools.execution.failed" });
        return {
          ok: false,
          status: 413,
          payload: {
            schemaVersion: "v0.0.1:schema:definition-1",
            traceId,
            error: {
              code: "result_too_large",
              message: "Tool result exceeds the configured result size limit.",
              details: {
                toolExecutionId,
                byteLength: buffer.length,
                maxResultBytes: tool.maxResultBytes
              }
            }
          }
        };
      }
      const status = statusCode >= 400 ? "failed" : "ok";
      logTool(status === "ok" ? "info" : "error", status === "ok" ? "tool_management.execute.completed" : "tool_management.execute.failed", {
        traceId,
        toolExecutionId,
        toolId: tool.id,
        operationId: tool.operationId,
        risk: tool.risk,
        status,
        statusCode,
        resultBytes: buffer.length,
        durationMs
      });
      appendExecution({
        toolExecutionId,
        traceId,
        toolId: tool.id,
        toolVersion: tool.version,
        toolsetIds: tool.toolsets,
        subjectType: "grant",
        subjectId: authorization.grant.id,
        grantId: authorization.grant.id,
        agentId: context.agentId || "",
        profileId: context.profileId || "",
        operationId: tool.operationId,
        risk: tool.risk,
        decision: policy.effect,
        input,
        result: payload,
        resultSummary: {
          ...(tool.transport?.binary ? { type: "binary", byteLength: buffer.length } : resultSummaryFromPayload(payload)),
          policy: policySummary
        },
        status,
        errorCode: status === "ok" ? "" : "tool_handler_failed",
        durationMs,
        policyDecisionId: policy.decisionId,
        sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
        userAgent: request?.headers?.["user-agent"] || "",
        startedAt,
        finishedAt: nowIso()
      });
      store.appendMetric({
        traceId,
        toolId: tool.id,
        grantId: authorization.grant.id,
        profileId: context.profileId || "",
        status,
        risk: tool.risk,
        durationMs,
        inputBytes,
        resultBytes: buffer.length,
        reasonCode: status === "ok" ? "" : "tool_handler_failed"
      });
      await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status }, { type: status === "ok" ? "tools.execution.completed" : "tools.execution.failed" });
      return {
        ok: status === "ok",
        status: statusCode,
        captured,
        payload: {
          schemaVersion: "v0.0.1:schema:definition-1",
          toolExecutionId,
          traceId,
          toolId: tool.id,
          status,
          result: payload?.result !== undefined ? payload.result : payload,
          grant: authorization.grant,
          policy: policySummary
        }
      };
    } catch (error) {
      const durationMs = Date.now() - startedAtMs;
      const message = error instanceof Error ? error.message : "Tool execution failed.";
      const errorCode = error?.code === "tool_timeout" ? "tool_timeout" : "tool_execution_failed";
      logTool("error", "tool_management.execute.failed", {
        traceId,
        toolExecutionId,
        toolId: tool.id,
        operationId: tool.operationId,
        risk: tool.risk,
        reason: errorCode,
        durationMs,
        error: summarizeError(error)
      });
      appendExecution({
        toolExecutionId,
        traceId,
        toolId: tool.id,
        toolVersion: tool.version,
        toolsetIds: tool.toolsets,
        subjectType: "grant",
        subjectId: authorization.grant.id,
        grantId: authorization.grant.id,
        agentId: context.agentId || "",
        profileId: context.profileId || "",
        operationId: tool.operationId,
        risk: tool.risk,
        decision: policy.effect,
        input,
        resultSummary: {
          type: "runtime_error",
          errorCode,
          policy: policySummary
        },
        status: "failed",
        errorCode,
        durationMs,
        policyDecisionId: policy.decisionId,
        sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
        userAgent: request?.headers?.["user-agent"] || "",
        startedAt,
        finishedAt: nowIso()
      });
      store.appendMetric({
        traceId,
        toolId: tool.id,
        grantId: authorization.grant.id,
        profileId: context.profileId || "",
        status: "failed",
        risk: tool.risk,
        durationMs,
        inputBytes,
        reasonCode: errorCode
      });
      await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status: "failed" }, { type: "tools.execution.failed" });
      return {
        ok: false,
        status: 500,
        payload: {
          schemaVersion: "v0.0.1:schema:definition-1",
          traceId,
          error: {
            code: errorCode,
            message,
            details: {
              toolExecutionId,
              decisionId: policy.decisionId,
              policy: policySummary
            }
          }
        }
      };
    } finally {
      request.__pactToolRuntimeAuthorization = previousAuthorization;
    }
  }

  async function resumePendingOperation({
    pendingOperationId,
    resolution = "approved",
    request,
    context = {},
    resolvedBy = "",
    reason = ""
  } = {}) {
    const pending = store.getPendingOperation?.(pendingOperationId, { includeOriginalInput: true });
    if (!pending) {
      return {
        ok: false,
        status: 404,
        payload: {
          schemaVersion: "v0.0.1:schema:definition-1",
          error: {
            code: "pending_operation_not_found",
            message: "Pending operation was not found."
          }
        }
      };
    }
    if (pending.status !== "pending") {
      return {
        ok: false,
        status: 409,
        payload: {
          schemaVersion: "v0.0.1:schema:definition-1",
          pendingOperation: pending,
          error: {
            code: "pending_operation_not_pending",
            message: "Pending operation is not awaiting approval."
          }
        }
      };
    }
    if (resolution === "rejected") {
      const rejected = store.resolvePendingOperation({
        pendingOperationId: pending.pendingOperationId,
        resolution: "rejected",
        resolvedBy,
        reason,
        errorCode: "pending_operation_rejected",
        resultSummary: { type: "approval_decision", resolution: "rejected" }
      });
      store.appendMetric({
        traceId: pending.traceId,
        toolId: pending.toolId,
        grantId: pending.grantId,
        profileId: pending.profileId,
        status: "rejected",
        risk: pending.risk,
        reasonCode: "pending_operation_rejected"
      });
      await publishEvent("tools.pending_operation", {
        pendingOperationId: pending.pendingOperationId,
        traceId: pending.traceId,
        toolId: pending.toolId,
        status: "rejected"
      }, { type: "tools.pending_operation.rejected" });
      return {
        ok: true,
        status: 200,
        payload: {
          schemaVersion: "v0.0.1:schema:definition-1",
          status: "rejected",
          pendingOperation: rejected
        }
      };
    }
    if (resolution !== "approved") {
      return {
        ok: false,
        status: 400,
        payload: {
          schemaVersion: "v0.0.1:schema:definition-1",
          error: {
            code: "invalid_pending_operation_resolution",
            message: "Pending operation resolution must be approved or rejected."
          }
        }
      };
    }
    const approved = store.resolvePendingOperation({
      pendingOperationId: pending.pendingOperationId,
      resolution: "approved",
      resolvedBy,
      reason,
      resultSummary: { type: "approval_decision", resolution: "approved" }
    });
    const grant = store.getRawGrant?.(pending.grantId);
    if (!grant || grant.enabled === false || grant.revokedAt) {
      const failed = store.resolvePendingOperation({
        pendingOperationId: pending.pendingOperationId,
        resolution: "failed",
        resolvedBy,
        reason,
        errorCode: "pending_operation_grant_unavailable",
        resultSummary: { type: "approval_resume_failed", reason: "grant_unavailable" }
      });
      return {
        ok: false,
        status: 409,
        payload: {
          schemaVersion: "v0.0.1:schema:definition-1",
          status: "failed",
          pendingOperation: failed,
          error: {
            code: "pending_operation_grant_unavailable",
            message: "Original tool grant is no longer available."
          }
        }
      };
    }
    await publishEvent("tools.pending_operation", {
      pendingOperationId: pending.pendingOperationId,
      traceId: pending.traceId,
      toolId: pending.toolId,
      status: "approved"
    }, { type: "tools.pending_operation.approved" });
    const result = await executeTool({
      toolId: pending.toolId,
      input: pending.originalInput || {},
      request,
      context: {
        ...pending.context,
        ...context,
        traceId: pending.traceId,
        approval: {
          approved: true,
          pendingOperationId: pending.pendingOperationId,
          resolvedBy,
          resolvedAt: approved?.resolvedAt || nowIso()
        },
        pendingOperationApproved: true
      },
      authorizedGrant: grant,
      approvedPendingOperation: approved || pending
    });
    const finalStatus = result.ok ? "completed" : "failed";
    const completed = store.resolvePendingOperation({
      pendingOperationId: pending.pendingOperationId,
      resolution: finalStatus,
      resolvedBy,
      reason,
      errorCode: result.ok ? "" : result.payload?.error?.code || "pending_operation_resume_failed",
      resumedToolExecutionId: result.payload?.toolExecutionId || "",
      resultSummary: resultSummaryFromPayload(result.payload || {})
    });
    await publishEvent("tools.pending_operation", {
      pendingOperationId: pending.pendingOperationId,
      traceId: pending.traceId,
      toolId: pending.toolId,
      status: finalStatus,
      resumedToolExecutionId: result.payload?.toolExecutionId || ""
    }, { type: result.ok ? "tools.pending_operation.completed" : "tools.pending_operation.failed" });
    return {
      ...result,
      payload: {
        ...(result.payload || {}),
        pendingOperation: completed
      }
    };
  }

  return {
    refreshOperations,
    executeTool,
    resumePendingOperation
  };
}
