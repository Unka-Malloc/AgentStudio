import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../../../common/storage/sqlite-migrations.mjs";
import {
  evaluateAuthorizationPolicy,
  normalizeKernelCapabilities,
  toolExecuteCapabilityId,
  unknownKernelCapabilities
} from "../../../../common/security/authorization/authorization-engine.mjs";
import {
  OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
  createOpaqueCapabilityKeyProvider
} from "../../../../common/security/authorization/opaque-capability-key.mjs";
import {
  CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
  createCapabilityBindingGuard
} from "../../../../common/security/authorization/capability-binding-guard.mjs";
import {
  createCommandCapabilitySecurityClient
} from "../../../../common/security/authorization/capability-security-helper-client.mjs";
import {
  TOOL_MANAGEMENT_SCOPES,
  scopesToToolsets,
  toolsetsToScopes
} from "./catalog.mjs";

const TOKEN_PREFIX = "sat_";
const DEFAULT_RATE_LIMIT_PER_MINUTE = 0;

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
}

function createToken() {
  return `${TOKEN_PREFIX}${crypto.randomBytes(24).toString("base64url")}`;
}

function isEnabled(value = "") {
  return /^(1|true|yes|on|command|helper)$/i.test(String(value || "").trim());
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function readBearerToken(request) {
  const authorization = String(request?.headers?.authorization || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (match) {
    return match[1].trim();
  }
  return String(request?.headers?.["x-pact-tool-token"] || "").trim();
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function stringifyJson(value) {
  return JSON.stringify(value ?? null);
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
  }
  if (typeof value === "string") {
    return normalizeStringList(value.split(","));
  }
  return [];
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function normalizeScopes(scopes) {
  const valid = new Set(TOOL_MANAGEMENT_SCOPES.map((scope) => scope.id));
  return normalizeStringList(scopes).filter((scope) => valid.has(scope));
}

function normalizeRateLimit(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { perMinute: DEFAULT_RATE_LIMIT_PER_MINUTE };
  }
  return {
    perMinute: Math.max(0, Number(value.perMinute || value.per_minute || 0) || 0)
  };
}

function normalizeGrantInput(input = {}, fallback = {}) {
  const explicitScopes = normalizeScopes(input.scopes ?? fallback.scopes);
  const toolsets = normalizeStringList(input.toolsets ?? fallback.toolsets);
  const scopes = explicitScopes.length ? explicitScopes : normalizeScopes(toolsetsToScopes(toolsets));
  const normalizedToolsets = toolsets.length ? toolsets : scopesToToolsets(scopes);
  const createdAt = fallback.createdAt || nowIso();
  const fallbackMetadata = fallback.metadata && typeof fallback.metadata === "object" && !Array.isArray(fallback.metadata)
    ? fallback.metadata
    : {};
  const inputMetadata = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
    ? input.metadata
    : {};
  const metadata = {
    ...fallbackMetadata,
    ...inputMetadata
  };
  const capabilities = normalizeKernelCapabilities(
    input.capabilities,
    input.capabilityIds,
    metadata.capabilities,
    metadata.capabilityIds,
    fallback.capabilities,
    fallback.capabilityIds,
    fallbackMetadata.capabilities,
    fallbackMetadata.capabilityIds
  );
  const agentId = firstString(input.agentId, input.agent_id, input.agentProfileId, metadata.agentId, metadata.agentProfileId);
  const agentProfileId = firstString(input.agentProfileId, input.profileId, input.profile_id, metadata.agentProfileId, metadata.profileId, agentId);
  const boundUserId = firstString(input.boundUserId, input.bound_user_id, input.userId, input.user_id, metadata.boundUserId, metadata.userId);
  const teamIds = normalizeStringList(input.teamIds ?? input.team_ids ?? metadata.teamIds);
  return {
    id: String(input.id || fallback.id || randomId("grant")),
    label: String(input.label ?? fallback.label ?? "Agent Tool Grant").trim() || "Agent Tool Grant",
    type: String(input.type ?? fallback.type ?? "machine").trim() || "machine",
    enabled: input.enabled !== undefined ? input.enabled !== false : fallback.enabled !== false,
    toolsets: normalizedToolsets,
    toolAllow: normalizeStringList(input.toolAllow ?? fallback.toolAllow),
    toolDeny: normalizeStringList(input.toolDeny ?? fallback.toolDeny),
    scopes,
    capabilities,
    expiresAt: String(input.expiresAt ?? fallback.expiresAt ?? ""),
    maxUses: Math.max(0, Number(input.maxUses ?? fallback.maxUses ?? 0) || 0),
    rateLimit: normalizeRateLimit(input.rateLimit ?? fallback.rateLimit),
    allowedOrigins: normalizeStringList(input.allowedOrigins ?? fallback.allowedOrigins),
    allowedCidrs: normalizeStringList(input.allowedCidrs ?? fallback.allowedCidrs),
    metadata: {
      ...metadata,
      ...(agentId ? { agentId } : {}),
      ...(agentProfileId ? { agentProfileId, profileId: agentProfileId } : {}),
      ...(boundUserId ? { boundUserId, userId: boundUserId } : {}),
      ...(teamIds.length ? { teamIds } : {})
    },
    reason: String(input.reason ?? fallback.reason ?? ""),
    tokenHash: String(input.tokenHash ?? fallback.tokenHash ?? ""),
    tokenPrefix: String(input.tokenPrefix ?? fallback.tokenPrefix ?? ""),
    tokenFamilyId: String(input.tokenFamilyId ?? fallback.tokenFamilyId ?? randomId("token_family")),
    useCount: Math.max(0, Number(input.useCount ?? fallback.useCount ?? 0) || 0),
    createdAt,
    updatedAt: String(input.updatedAt ?? fallback.updatedAt ?? createdAt),
    revokedAt: String(input.revokedAt ?? fallback.revokedAt ?? ""),
    lastUsedAt: String(input.lastUsedAt ?? fallback.lastUsedAt ?? "")
  };
}

function sanitizeGrantMetadata(metadata = {}) {
  const source = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const {
    capabilities,
    capabilityIds,
    permissions,
    ...safeMetadata
  } = source;
  void capabilities;
  void capabilityIds;
  void permissions;
  return safeMetadata;
}

function rejectUnknownGrantCapabilities(input = {}) {
  const metadata = input?.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
    ? input.metadata
    : {};
  const unknown = unknownKernelCapabilities(
    input?.capabilities,
    input?.capabilityIds,
    metadata.capabilities,
    metadata.capabilityIds
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown tool grant capability permission: ${unknown.join(", ")}`);
  }
}

function credentialFromMetadata(metadata = {}) {
  const source = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const protocolVersion = String(source.credentialProtocol || source.protocolVersion || "").trim();
  const credentialId = String(source.credentialId || "").trim();
  if (!protocolVersion && !credentialId) {
    return null;
  }
  return {
    protocolVersion,
    credentialId,
    capabilitySetHash: String(source.capabilitySetHash || "").trim(),
    capabilityCount: Math.max(0, Number(source.capabilityCount || 0) || 0),
    runtimeLookupGeneration: Math.max(0, Number(source.runtimeLookupGeneration || 0) || 0),
    bindingProtocol: String(source.credentialBindingProtocol || "").trim(),
    bindingStrength: String(source.credentialBindingStrength || "").trim(),
    bindingRequiredUser: source.credentialBindingRequiredUser === true,
    bindingRequiredAgent: source.credentialBindingRequiredAgent === true,
    issuedAt: String(source.credentialIssuedAt || "").trim(),
    expiresAt: String(source.credentialExpiresAt || "").trim()
  };
}

function resolveGrantCapabilities(grant = {}, { registry = null, capabilityResolver = null } = {}) {
  const explicit = normalizeKernelCapabilities(
    grant.capabilities,
    grant.capabilityIds,
    grant.metadata?.capabilities,
    grant.metadata?.capabilityIds
  );
  let resolved = [];
  if (typeof capabilityResolver === "function") {
    resolved = normalizeKernelCapabilities(capabilityResolver(grant));
  } else if (registry && typeof registry.resolveToolset === "function") {
    const explicitToolsets = Array.isArray(grant.toolsets) && grant.toolsets.length > 0;
    const toolsetResolution = registry.resolveToolset({
      toolsets: grant.toolsets,
      scopes: explicitToolsets ? [] : grant.scopes,
      toolAllow: grant.toolAllow,
      toolDeny: grant.toolDeny
    });
    resolved = normalizeKernelCapabilities(
      (toolsetResolution.tools || []).map((tool) => toolExecuteCapabilityId(tool.id))
    );
  }
  return normalizeKernelCapabilities(explicit, resolved);
}

function credentialMetadataFromIssue(issue = {}) {
  return sanitizeGrantMetadata({
    credentialProtocol: issue.protocolVersion || OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
    credentialId: issue.credentialId || "",
    capabilitySetHash: issue.capabilitySetHash || "",
    capabilityCount: issue.capabilityCount || 0,
    runtimeLookupGeneration: issue.runtimeLookupGeneration || 0,
    credentialIssuedAt: nowIso(),
    credentialExpiresAt: issue.expiresAt || ""
  });
}

function credentialBindingMetadata(binding = {}) {
  if (!binding || typeof binding !== "object") {
    return {};
  }
  return sanitizeGrantMetadata({
    credentialBindingProtocol: binding.protocolVersion || CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
    credentialBindingId: binding.bindingId || "",
    credentialBindingStrength: binding.bindingStrength || "",
    credentialBindingRequiredUser: binding.requireUser === true,
    credentialBindingRequiredAgent: binding.requireAgent === true,
    credentialBindingRequiredClient: binding.requireClient === true
  });
}

function headerValue(request, ...names) {
  const headers = request?.headers || {};
  for (const name of names) {
    const value = headers[name] ?? headers[String(name || "").toLowerCase()];
    const normalized = String(value || "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function bindingContextFromGrant(grant = {}) {
  const metadata = grant.metadata && typeof grant.metadata === "object" && !Array.isArray(grant.metadata)
    ? grant.metadata
    : {};
  return {
    namespace: "tool-management",
    agentId: firstString(grant.agentId, metadata.agentId, metadata.agentProfileId, metadata.profileId),
    agentProfileId: firstString(grant.agentProfileId, metadata.agentProfileId, metadata.profileId, metadata.agentId),
    userId: firstString(grant.boundUserId, grant.userId, metadata.boundUserId, metadata.userId),
    boundUserId: firstString(grant.boundUserId, grant.userId, metadata.boundUserId, metadata.userId),
    clientId: firstString(grant.clientId, metadata.clientId, metadata.clientName)
  };
}

function bindingContextFromRequest({ request = null, context = {} } = {}) {
  const requestContext = context && typeof context === "object" && !Array.isArray(context) ? context : {};
  return {
    namespace: firstString(
      requestContext.namespace,
      requestContext.bindingNamespace,
      headerValue(request, "x-pact-binding-namespace", "x-pact-namespace"),
      "tool-management"
    ),
    agentId: firstString(
      requestContext.agentId,
      requestContext.agentProfileId,
      requestContext.profileId,
      headerValue(request, "x-pact-agent-id", "x-pact-agent-profile-id", "x-pact-profile-id")
    ),
    agentProfileId: firstString(
      requestContext.agentProfileId,
      requestContext.profileId,
      requestContext.agentId,
      headerValue(request, "x-pact-agent-profile-id", "x-pact-profile-id", "x-pact-agent-id")
    ),
    userId: firstString(
      requestContext.boundUserId,
      requestContext.userId,
      requestContext.subjectId,
      headerValue(request, "x-pact-bound-user-id", "x-pact-user-id", "x-pact-subject-id")
    ),
    boundUserId: firstString(
      requestContext.boundUserId,
      requestContext.userId,
      requestContext.subjectId,
      headerValue(request, "x-pact-bound-user-id", "x-pact-user-id", "x-pact-subject-id")
    ),
    clientId: firstString(
      requestContext.clientId,
      requestContext.clientName,
      headerValue(request, "x-pact-client-id", "x-pact-client-name")
    )
  };
}

function hasColumn(db, tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all()
    .some((column) => column.name === columnName);
}

function addColumnIfMissing(db, tableName, columnName, columnSql) {
  if (hasColumn(db, tableName, columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`);
}

function ensureSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS tool_grants (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      toolsets_json TEXT NOT NULL DEFAULT '[]',
      tool_allow_json TEXT NOT NULL DEFAULT '[]',
      tool_deny_json TEXT NOT NULL DEFAULT '[]',
      scopes_json TEXT NOT NULL DEFAULT '[]',
      expires_at TEXT NOT NULL DEFAULT '',
      max_uses INTEGER NOT NULL DEFAULT 0,
      rate_limit_json TEXT NOT NULL DEFAULT '{}',
      allowed_origins_json TEXT NOT NULL DEFAULT '[]',
      allowed_cidrs_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      reason TEXT NOT NULL DEFAULT '',
      token_hash TEXT NOT NULL DEFAULT '',
      token_prefix TEXT NOT NULL DEFAULT '',
      token_family_id TEXT NOT NULL DEFAULT '',
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revoked_at TEXT NOT NULL DEFAULT '',
      last_used_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS tool_grant_events (
      event_id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_policy_decisions (
      decision_id TEXT PRIMARY KEY,
      tool_execution_id TEXT NOT NULL DEFAULT '',
      trace_id TEXT NOT NULL DEFAULT '',
      tool_id TEXT NOT NULL,
      grant_id TEXT NOT NULL DEFAULT '',
      effect TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      missing_scopes_json TEXT NOT NULL DEFAULT '[]',
      missing_toolsets_json TEXT NOT NULL DEFAULT '[]',
      evaluated_layers_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_executions (
      tool_execution_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      tool_version TEXT NOT NULL DEFAULT '',
      toolset_ids_json TEXT NOT NULL DEFAULT '[]',
      subject_type TEXT NOT NULL DEFAULT '',
      subject_id TEXT NOT NULL DEFAULT '',
      grant_id TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      profile_id TEXT NOT NULL DEFAULT '',
      operation_id TEXT NOT NULL DEFAULT '',
      risk TEXT NOT NULL DEFAULT '',
      decision TEXT NOT NULL DEFAULT '',
      input_hash TEXT NOT NULL DEFAULT '',
      redacted_input_json TEXT NOT NULL DEFAULT '{}',
      result_summary_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      policy_decision_id TEXT NOT NULL DEFAULT '',
      approval_id TEXT NOT NULL DEFAULT '',
      source_ip TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_metric_events (
      metric_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL DEFAULT '',
      tool_id TEXT NOT NULL,
      grant_id TEXT NOT NULL DEFAULT '',
      profile_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      risk TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      input_bytes INTEGER NOT NULL DEFAULT 0,
      result_bytes INTEGER NOT NULL DEFAULT 0,
      transfer_bytes INTEGER NOT NULL DEFAULT 0,
      bytes_per_second REAL NOT NULL DEFAULT 0,
      reason_code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS http_request_metric_events (
      metric_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL DEFAULT '',
      request_id TEXT NOT NULL DEFAULT '',
      transport TEXT NOT NULL DEFAULT 'http',
      method TEXT NOT NULL DEFAULT '',
      route TEXT NOT NULL DEFAULT '',
      status_code INTEGER NOT NULL DEFAULT 0,
      completion_status TEXT NOT NULL DEFAULT 'completed',
      request_bytes INTEGER NOT NULL DEFAULT 0,
      response_bytes INTEGER NOT NULL DEFAULT 0,
      transfer_bytes INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      bytes_per_second REAL NOT NULL DEFAULT 0,
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_catalog_snapshots (
      fingerprint TEXT PRIMARY KEY,
      catalog_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tool_grants_enabled ON tool_grants(enabled);
    CREATE INDEX IF NOT EXISTS idx_tool_executions_created ON tool_executions(started_at);
    CREATE INDEX IF NOT EXISTS idx_tool_executions_tool ON tool_executions(tool_id);
    CREATE INDEX IF NOT EXISTS idx_tool_executions_status ON tool_executions(status);
    CREATE INDEX IF NOT EXISTS idx_tool_metric_events_created ON tool_metric_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_tool_metric_events_tool ON tool_metric_events(tool_id);
    CREATE INDEX IF NOT EXISTS idx_http_request_metric_events_created ON http_request_metric_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_http_request_metric_events_route ON http_request_metric_events(route);

    CREATE TABLE IF NOT EXISTS mcp_authorization_requests (
      request_id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL DEFAULT '',
      requested_scopes_json TEXT NOT NULL DEFAULT '[]',
      requested_tools_json TEXT NOT NULL DEFAULT '[]',
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      source_ip TEXT NOT NULL DEFAULT '',
      grant_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      resolved_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_auth_req_status ON mcp_authorization_requests(status);
  `);

  // Version-controlled migrations — add new steps here as the schema evolves.
  runMigrations(db, [
    // version 1: baseline — all tables above were created by the initial db.exec.
    // Reserve this slot so existing databases get user_version = 1 applied.
    { version: 1, up: () => {} },
    // version 2: add mcp_authorization_requests
    {
      version: 2,
      up: (db) => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS mcp_authorization_requests (
            request_id TEXT PRIMARY KEY,
            client_name TEXT NOT NULL DEFAULT '',
            requested_scopes_json TEXT NOT NULL DEFAULT '[]',
            requested_tools_json TEXT NOT NULL DEFAULT '[]',
            reason TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            source_ip TEXT NOT NULL DEFAULT '',
            grant_id TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            resolved_at TEXT NOT NULL DEFAULT ''
          );
          CREATE INDEX IF NOT EXISTS idx_mcp_auth_req_status ON mcp_authorization_requests(status);
        `);
      }
    },
    // version 3: request metrics and byte-rate columns for commercial usage telemetry.
    {
      version: 3,
      up: (db) => {
        addColumnIfMissing(db, "tool_metric_events", "input_bytes", "input_bytes INTEGER NOT NULL DEFAULT 0");
        addColumnIfMissing(db, "tool_metric_events", "transfer_bytes", "transfer_bytes INTEGER NOT NULL DEFAULT 0");
        addColumnIfMissing(db, "tool_metric_events", "bytes_per_second", "bytes_per_second REAL NOT NULL DEFAULT 0");
        db.exec(`
          CREATE TABLE IF NOT EXISTS http_request_metric_events (
            metric_id TEXT PRIMARY KEY,
            trace_id TEXT NOT NULL DEFAULT '',
            request_id TEXT NOT NULL DEFAULT '',
            transport TEXT NOT NULL DEFAULT 'http',
            method TEXT NOT NULL DEFAULT '',
            route TEXT NOT NULL DEFAULT '',
            status_code INTEGER NOT NULL DEFAULT 0,
            completion_status TEXT NOT NULL DEFAULT 'completed',
            request_bytes INTEGER NOT NULL DEFAULT 0,
            response_bytes INTEGER NOT NULL DEFAULT 0,
            transfer_bytes INTEGER NOT NULL DEFAULT 0,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            bytes_per_second REAL NOT NULL DEFAULT 0,
            user_agent TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_tool_metric_events_tool ON tool_metric_events(tool_id);
          CREATE INDEX IF NOT EXISTS idx_http_request_metric_events_created ON http_request_metric_events(created_at);
          CREATE INDEX IF NOT EXISTS idx_http_request_metric_events_route ON http_request_metric_events(route);
        `);
      }
    }
  ]);
}

function rowToGrant(row) {
  if (!row) {
    return null;
  }
  const metadata = parseJson(row.metadata_json, {});
  return {
    id: row.id,
    label: row.label,
    type: row.type,
    enabled: Boolean(row.enabled),
    toolsets: parseJson(row.toolsets_json, []),
    toolAllow: parseJson(row.tool_allow_json, []),
    toolDeny: parseJson(row.tool_deny_json, []),
    scopes: parseJson(row.scopes_json, []),
    capabilities: normalizeKernelCapabilities(metadata.capabilities, metadata.capabilityIds),
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    rateLimit: parseJson(row.rate_limit_json, {}),
    allowedOrigins: parseJson(row.allowed_origins_json, []),
    allowedCidrs: parseJson(row.allowed_cidrs_json, []),
    metadata,
    reason: row.reason,
    tokenHash: row.token_hash,
    tokenPrefix: row.token_prefix,
    tokenFamilyId: row.token_family_id,
    useCount: row.use_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at
  };
}

function publicGrant(grant) {
  if (!grant) {
    return null;
  }
  const { tokenHash, ...rest } = grant;
  const metadata = sanitizeGrantMetadata(rest.metadata);
  return {
    ...rest,
    metadata,
    capabilities: [],
    credential: credentialFromMetadata(metadata),
    hasToken: Boolean(tokenHash)
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

function hashValue(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function summarizeValue(value) {
  if (value === null || value === undefined) {
    return {};
  }
  if (Buffer.isBuffer(value)) {
    return { type: "buffer", byteLength: value.length, sha256: crypto.createHash("sha256").update(value).digest("hex") };
  }
  if (typeof value !== "object") {
    return { value };
  }
  if (Array.isArray(value)) {
    return { type: "array", length: value.length };
  }
  const summary = {};
  for (const [key, nested] of Object.entries(value).slice(0, 40)) {
    if (/token|secret|password|authorization|cookie|api[-_]?key/i.test(key)) {
      summary[key] = "<redacted>";
    } else if (Array.isArray(nested)) {
      summary[key] = { type: "array", length: nested.length };
    } else if (nested && typeof nested === "object") {
      summary[key] = { type: "object", keys: Object.keys(nested).slice(0, 20) };
    } else {
      summary[key] = nested;
    }
  }
  return summary;
}

function summarizeRequestMetricRows(rows = []) {
  const byStatusCode = {};
  const byCompletionStatus = {};
  const byMethod = {};
  const byRoute = {};
  const byTransport = {};
  let durationTotal = 0;
  let requestBytesTotal = 0;
  let responseBytesTotal = 0;
  let transferBytesTotal = 0;
  let byteRateTotal = 0;
  let peakBytesPerSecond = 0;
  let successTotal = 0;
  let clientErrorTotal = 0;
  let serverErrorTotal = 0;
  let completionFailureTotal = 0;
  const durationRows = [];
  let firstTimestamp = 0;
  let lastTimestamp = 0;

  for (const row of rows) {
    const statusKey = String(row.status_code || 0);
    const statusCode = Number(row.status_code || 0);
    const completionStatus = row.completion_status || "unknown";
    byStatusCode[statusKey] = (byStatusCode[statusKey] || 0) + 1;
    byCompletionStatus[completionStatus] = (byCompletionStatus[completionStatus] || 0) + 1;
    byMethod[row.method || ""] = (byMethod[row.method || ""] || 0) + 1;
    byRoute[row.route || ""] = (byRoute[row.route || ""] || 0) + 1;
    byTransport[row.transport || "http"] = (byTransport[row.transport || "http"] || 0) + 1;

    const durationMs = Number(row.duration_ms || 0);
    const requestBytes = Number(row.request_bytes || 0);
    const responseBytes = Number(row.response_bytes || 0);
    const transferBytes = Number(row.transfer_bytes || requestBytes + responseBytes);
    const bytesPerSecond = Number(row.bytes_per_second || 0);
    durationTotal += durationMs;
    durationRows.push({ duration_ms: durationMs });
    requestBytesTotal += requestBytes;
    responseBytesTotal += responseBytes;
    transferBytesTotal += transferBytes;
    byteRateTotal += bytesPerSecond;
    peakBytesPerSecond = Math.max(peakBytesPerSecond, bytesPerSecond);
    successTotal += statusCode >= 200 && statusCode < 400 ? 1 : 0;
    clientErrorTotal += statusCode >= 400 && statusCode < 500 ? 1 : 0;
    serverErrorTotal += statusCode >= 500 ? 1 : 0;
    completionFailureTotal += completionStatus === "completed" ? 0 : 1;

    const timestamp = Date.parse(row.created_at || "");
    if (Number.isFinite(timestamp)) {
      firstTimestamp = firstTimestamp ? Math.min(firstTimestamp, timestamp) : timestamp;
      lastTimestamp = Math.max(lastTimestamp, timestamp);
    }
  }

  const observedWindowSeconds = rows.length
    ? Math.max(1, Number(((lastTimestamp - firstTimestamp) / 1000).toFixed(3)) || 1)
    : 0;

  return {
    total: rows.length,
    byStatusCode,
    byCompletionStatus,
    byMethod,
    byRoute,
    byTransport,
    successTotal,
    clientErrorTotal,
    serverErrorTotal,
    completionFailureTotal,
    serverErrorRate: ratio(serverErrorTotal, rows.length),
    clientErrorRate: ratio(clientErrorTotal, rows.length),
    completionFailureRate: ratio(completionFailureTotal, rows.length),
    requestBytesTotal,
    responseBytesTotal,
    transferBytesTotal,
    averageDurationMs: rows.length ? Number((durationTotal / rows.length).toFixed(2)) : 0,
    durationPercentiles: durationPercentilesFromRows(durationRows),
    observedWindowSeconds,
    requestsPerMinute: observedWindowSeconds
      ? Number(((rows.length * 60) / observedWindowSeconds).toFixed(2))
      : 0,
    transferBytesPerSecond: observedWindowSeconds
      ? Number((transferBytesTotal / observedWindowSeconds).toFixed(2))
      : 0,
    averageBytesPerSecond: rows.length ? Number((byteRateTotal / rows.length).toFixed(2)) : 0,
    peakBytesPerSecond
  };
}

function normalizeMetricLimit(value) {
  return Math.max(1, Math.min(Number(value || 2000), 10000));
}

function normalizeBucketSeconds(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.max(1, Math.min(Math.floor(parsed), 86_400));
}

function normalizeMetricWindowSeconds(value) {
  const parsed = Number(value || 300);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 300;
  }
  return Math.max(1, Math.min(Math.floor(parsed), 86_400));
}

function normalizeMetricExportKind(value) {
  const normalized = String(value || "all").trim().toLowerCase();
  if (normalized === "tool" || normalized === "tools" || normalized === "tool_calls") {
    return "tool";
  }
  if (normalized === "request" || normalized === "requests" || normalized === "http") {
    return "request";
  }
  return "all";
}

function normalizeMetricThreshold(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  if (parsed > 1 && parsed <= 100) {
    return Number((parsed / 100).toFixed(4));
  }
  return Math.min(parsed, 1);
}

function normalizeMetricDurationThreshold(value, fallback = 0) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Number(Math.min(parsed, 86_400_000).toFixed(2));
}

function safeFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function metricWindowSeconds(oldestCreatedAt = "", newestCreatedAt = "", rows = 0) {
  if (!rows) {
    return 0;
  }
  const oldest = Date.parse(oldestCreatedAt || "");
  const newest = Date.parse(newestCreatedAt || "");
  if (!Number.isFinite(oldest) || !Number.isFinite(newest)) {
    return 1;
  }
  return Math.max(1, Number(((newest - oldest) / 1000).toFixed(3)) || 1);
}

function ratio(part, total) {
  const denominator = Number(total || 0);
  if (!denominator) {
    return 0;
  }
  return Number((Number(part || 0) / denominator).toFixed(4));
}

function percentileFromSortedValues(values = [], quantile = 0) {
  if (!values.length) {
    return 0;
  }
  const normalizedQuantile = Math.min(1, Math.max(0, Number(quantile || 0)));
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(normalizedQuantile * values.length) - 1));
  return Number(Number(values[index] || 0).toFixed(2));
}

function durationPercentilesFromRows(rows = []) {
  const values = rows
    .map((row) => Number(row.duration_ms || 0))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  return {
    p50Ms: percentileFromSortedValues(values, 0.5),
    p95Ms: percentileFromSortedValues(values, 0.95),
    p99Ms: percentileFromSortedValues(values, 0.99)
  };
}

function summarizeToolUsageDimension(rows = [], columnName = "", outputKey = "", limit = 10) {
  const summaries = new Map();
  for (const row of rows) {
    const dimensionValue = String(row[columnName] || "").trim();
    if (!dimensionValue) {
      continue;
    }
    if (!summaries.has(dimensionValue)) {
      summaries.set(dimensionValue, {
        [outputKey]: dimensionValue,
        total: 0,
        okTotal: 0,
        deniedTotal: 0,
        failureTotal: 0,
        inputBytesTotal: 0,
        resultBytesTotal: 0,
        transferBytesTotal: 0,
        durationTotal: 0,
        byteRateTotal: 0,
        peakBytesPerSecond: 0,
        durationRows: []
      });
    }
    const summary = summaries.get(dimensionValue);
    const status = row.status || "unknown";
    const durationMs = Number(row.duration_ms || 0);
    const inputBytes = Number(row.input_bytes || 0);
    const resultBytes = Number(row.result_bytes || 0);
    const transferBytes = Number(row.transfer_bytes || inputBytes + resultBytes);
    const bytesPerSecond = Number(row.bytes_per_second || 0);
    summary.total += 1;
    summary.okTotal += status === "ok" ? 1 : 0;
    summary.deniedTotal += status === "denied" ? 1 : 0;
    summary.failureTotal += status === "ok" ? 0 : 1;
    summary.inputBytesTotal += inputBytes;
    summary.resultBytesTotal += resultBytes;
    summary.transferBytesTotal += transferBytes;
    summary.durationTotal += durationMs;
    summary.byteRateTotal += bytesPerSecond;
    summary.peakBytesPerSecond = Math.max(summary.peakBytesPerSecond, bytesPerSecond);
    summary.durationRows.push({ duration_ms: durationMs });
  }

  return [...summaries.values()]
    .sort((left, right) =>
      right.total - left.total ||
      right.transferBytesTotal - left.transferBytesTotal ||
      String(left[outputKey]).localeCompare(String(right[outputKey]))
    )
    .slice(0, Math.max(1, Number(limit || 10)))
    .map((summary) => {
      const { durationRows, durationTotal, byteRateTotal, ...publicSummary } = summary;
      return {
        ...publicSummary,
        failureRate: ratio(summary.failureTotal, summary.total),
        deniedRate: ratio(summary.deniedTotal, summary.total),
        averageDurationMs: summary.total ? Number((durationTotal / summary.total).toFixed(2)) : 0,
        durationPercentiles: durationPercentilesFromRows(durationRows),
        averageBytesPerSecond: summary.total ? Number((byteRateTotal / summary.total).toFixed(2)) : 0
      };
    });
}

function prometheusEscapeLabel(value = "") {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, "\\\"");
}

function prometheusLabels(labels = {}) {
  const entries = Object.entries(labels)
    .filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!entries.length) {
    return "";
  }
  return `{${entries.map(([key, value]) => `${key}="${prometheusEscapeLabel(value)}"`).join(",")}}`;
}

function prometheusSample(name, value, labels = {}) {
  const numericValue = Number(value || 0);
  return `${name}${prometheusLabels(labels)} ${Number.isFinite(numericValue) ? numericValue : 0}`;
}

function createMetricClauses({
  since = "",
  until = "",
  status = "",
  toolId = "",
  grantId = "",
  profileId = "",
  route = "",
  transport = "",
  statusCode = "",
  completionStatus = ""
} = {}, kind = "tool") {
  const clauses = [];
  const params = [];
  if (since) {
    clauses.push("created_at >= ?");
    params.push(String(since));
  }
  if (until) {
    clauses.push("created_at <= ?");
    params.push(String(until));
  }
  if (kind === "tool") {
    if (toolId) {
      clauses.push("tool_id = ?");
      params.push(String(toolId));
    }
    if (grantId) {
      clauses.push("grant_id = ?");
      params.push(String(grantId));
    }
    if (profileId) {
      clauses.push("profile_id = ?");
      params.push(String(profileId));
    }
    if (status) {
      clauses.push("status = ?");
      params.push(String(status));
    }
  } else {
    if (route) {
      clauses.push("route = ?");
      params.push(String(route));
    }
    if (transport) {
      clauses.push("transport = ?");
      params.push(String(transport));
    }
    if (statusCode) {
      clauses.push("status_code = ?");
      params.push(Math.max(0, Number(statusCode || 0) || 0));
    }
    if (completionStatus || status) {
      clauses.push("completion_status = ?");
      params.push(String(completionStatus || status));
    }
  }
  return { clauses, params };
}

function rowToToolMetricEvent(row) {
  return {
    metricId: row.metric_id,
    traceId: row.trace_id,
    toolId: row.tool_id,
    grantId: row.grant_id,
    profileId: row.profile_id,
    status: row.status,
    risk: row.risk,
    durationMs: row.duration_ms,
    inputBytes: row.input_bytes,
    resultBytes: row.result_bytes,
    transferBytes: row.transfer_bytes,
    bytesPerSecond: row.bytes_per_second,
    reasonCode: row.reason_code,
    createdAt: row.created_at
  };
}

function rowToHttpRequestMetricEvent(row) {
  return {
    metricId: row.metric_id,
    traceId: row.trace_id,
    requestId: row.request_id,
    transport: row.transport,
    method: row.method,
    route: row.route,
    statusCode: row.status_code,
    completionStatus: row.completion_status,
    requestBytes: row.request_bytes,
    responseBytes: row.response_bytes,
    transferBytes: row.transfer_bytes,
    durationMs: row.duration_ms,
    bytesPerSecond: row.bytes_per_second,
    createdAt: row.created_at
  };
}

function bucketStartMs(createdAt = "", bucketSeconds = 60) {
  const timestamp = Date.parse(createdAt || "");
  if (!Number.isFinite(timestamp)) {
    return 0;
  }
  const bucketMs = Math.max(1, Number(bucketSeconds || 60)) * 1000;
  return Math.floor(timestamp / bucketMs) * bucketMs;
}

function emptyBucket(startMs, bucketSeconds) {
  const endMs = startMs + (bucketSeconds * 1000);
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    toolCalls: {
      total: 0,
      byStatus: {},
      byTool: {},
      inputBytesTotal: 0,
      resultBytesTotal: 0,
      transferBytesTotal: 0
    },
    requests: {
      total: 0,
      byStatusCode: {},
      byCompletionStatus: {},
      byRoute: {},
      byTransport: {},
      successTotal: 0,
      clientErrorTotal: 0,
      serverErrorTotal: 0,
      completionFailureTotal: 0,
      requestBytesTotal: 0,
      responseBytesTotal: 0,
      transferBytesTotal: 0
    }
  };
}

function summarizeMetricBuckets({ toolRows = [], requestRows = [], bucketSeconds = 0 } = {}) {
  const normalizedBucketSeconds = normalizeBucketSeconds(bucketSeconds);
  if (!normalizedBucketSeconds) {
    return {
      bucketSeconds: 0,
      buckets: []
    };
  }
  const buckets = new Map();
  const ensureBucket = (createdAt) => {
    const startMs = bucketStartMs(createdAt, normalizedBucketSeconds);
    if (!startMs) {
      return null;
    }
    if (!buckets.has(startMs)) {
      buckets.set(startMs, emptyBucket(startMs, normalizedBucketSeconds));
    }
    return buckets.get(startMs);
  };

  for (const row of toolRows) {
    const bucket = ensureBucket(row.created_at);
    if (!bucket) {
      continue;
    }
    const status = row.status || "unknown";
    const toolId = row.tool_id || "unknown";
    const inputBytes = Number(row.input_bytes || 0);
    const resultBytes = Number(row.result_bytes || 0);
    const transferBytes = Number(row.transfer_bytes || inputBytes + resultBytes);
    bucket.toolCalls.total += 1;
    bucket.toolCalls.byStatus[status] = (bucket.toolCalls.byStatus[status] || 0) + 1;
    bucket.toolCalls.byTool[toolId] = (bucket.toolCalls.byTool[toolId] || 0) + 1;
    bucket.toolCalls.inputBytesTotal += inputBytes;
    bucket.toolCalls.resultBytesTotal += resultBytes;
    bucket.toolCalls.transferBytesTotal += transferBytes;
  }

  for (const row of requestRows) {
    const bucket = ensureBucket(row.created_at);
    if (!bucket) {
      continue;
    }
    const statusCode = String(row.status_code || 0);
    const numericStatusCode = Number(row.status_code || 0);
    const completionStatus = row.completion_status || "unknown";
    const route = row.route || "";
    const transport = row.transport || "http";
    const requestBytes = Number(row.request_bytes || 0);
    const responseBytes = Number(row.response_bytes || 0);
    const transferBytes = Number(row.transfer_bytes || requestBytes + responseBytes);
    bucket.requests.total += 1;
    bucket.requests.byStatusCode[statusCode] = (bucket.requests.byStatusCode[statusCode] || 0) + 1;
    bucket.requests.byCompletionStatus[completionStatus] =
      (bucket.requests.byCompletionStatus[completionStatus] || 0) + 1;
    bucket.requests.byRoute[route] = (bucket.requests.byRoute[route] || 0) + 1;
    bucket.requests.byTransport[transport] = (bucket.requests.byTransport[transport] || 0) + 1;
    bucket.requests.successTotal += numericStatusCode >= 200 && numericStatusCode < 400 ? 1 : 0;
    bucket.requests.clientErrorTotal += numericStatusCode >= 400 && numericStatusCode < 500 ? 1 : 0;
    bucket.requests.serverErrorTotal += numericStatusCode >= 500 ? 1 : 0;
    bucket.requests.completionFailureTotal += completionStatus === "completed" ? 0 : 1;
    bucket.requests.requestBytesTotal += requestBytes;
    bucket.requests.responseBytesTotal += responseBytes;
    bucket.requests.transferBytesTotal += transferBytes;
  }

  return {
    bucketSeconds: normalizedBucketSeconds,
    buckets: [...buckets.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, bucket]) => bucket)
  };
}

function normalizeRetentionDays(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.max(1, Math.min(Math.floor(parsed), 3650));
}

function normalizeMetricMaxRows(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.max(1, Math.min(Math.floor(parsed), 1_000_000));
}

function retentionCutoffIso({ olderThan = "", retentionDays = 0 } = {}) {
  const explicit = String(olderThan || "").trim();
  if (explicit) {
    const parsed = Date.parse(explicit);
    if (!Number.isFinite(parsed)) {
      throw new Error("Metric prune olderThan must be an ISO timestamp.");
    }
    return new Date(parsed).toISOString();
  }
  const days = normalizeRetentionDays(retentionDays);
  if (!days) {
    return "";
  }
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function getToolManagementDatabasePath(userDataPath) {
  return path.join(userDataPath, "tool-management", "tool-management.sqlite");
}

export function createToolManagementStore({
  userDataPath,
  registry = null,
  capabilityResolver = null,
  capabilityKeyProvider = null,
  capabilityBindingGuard = null
}) {
  const rootPath = path.join(userDataPath, "tool-management");
  fs.mkdirSync(rootPath, { recursive: true });
  const db = new Database(getToolManagementDatabasePath(userDataPath));
  ensureSchema(db);
  const securityHelperClient = (!capabilityKeyProvider && !capabilityBindingGuard && isEnabled(
    process.env.PACT_TOOL_GRANT_CAPABILITY_SECURITY_HELPER ||
      process.env.PACT_CAPABILITY_SECURITY_HELPER
  ))
    ? createCommandCapabilitySecurityClient({
        dataDir: userDataPath,
        backend: process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER ||
          process.env.PACT_OPAQUE_CAPABILITY_KEY_PROVIDER ||
          "auto",
        alias: process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_ALIAS || "pact-tool-grants",
        bindingBackend: process.env.PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER ||
          process.env.PACT_CAPABILITY_BINDING_GUARD_PROVIDER ||
          "auto",
        bindingAlias: process.env.PACT_TOOL_GRANT_BINDING_GUARD_ALIAS || "pact-tool-bindings"
      })
    : null;
  const resolvedCapabilityKeyProvider =
    capabilityKeyProvider ||
    securityHelperClient ||
    createOpaqueCapabilityKeyProvider({
      dataDir: userDataPath,
      backend: process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER ||
        process.env.PACT_OPAQUE_CAPABILITY_KEY_PROVIDER ||
        "auto",
      alias: process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_ALIAS || "pact-tool-grants"
    });
  const resolvedCapabilityBindingGuard = capabilityBindingGuard === false
    ? null
    : capabilityBindingGuard ||
      securityHelperClient ||
      createCapabilityBindingGuard({
        dataDir: userDataPath,
        backend: process.env.PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER ||
          process.env.PACT_CAPABILITY_BINDING_GUARD_PROVIDER ||
          "auto",
        alias: process.env.PACT_TOOL_GRANT_BINDING_GUARD_ALIAS || "pact-tool-bindings"
      });

  const upsertGrantStmt = db.prepare(`
    INSERT INTO tool_grants (
      id, label, type, enabled, toolsets_json, tool_allow_json, tool_deny_json, scopes_json,
      expires_at, max_uses, rate_limit_json, allowed_origins_json, allowed_cidrs_json,
      metadata_json, reason, token_hash, token_prefix, token_family_id, use_count,
      created_at, updated_at, revoked_at, last_used_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      type = excluded.type,
      enabled = excluded.enabled,
      toolsets_json = excluded.toolsets_json,
      tool_allow_json = excluded.tool_allow_json,
      tool_deny_json = excluded.tool_deny_json,
      scopes_json = excluded.scopes_json,
      expires_at = excluded.expires_at,
      max_uses = excluded.max_uses,
      rate_limit_json = excluded.rate_limit_json,
      allowed_origins_json = excluded.allowed_origins_json,
      allowed_cidrs_json = excluded.allowed_cidrs_json,
      metadata_json = excluded.metadata_json,
      reason = excluded.reason,
      token_hash = excluded.token_hash,
      token_prefix = excluded.token_prefix,
      token_family_id = excluded.token_family_id,
      use_count = excluded.use_count,
      updated_at = excluded.updated_at,
      revoked_at = excluded.revoked_at,
      last_used_at = excluded.last_used_at
  `);

  function upsertGrant(grant) {
    upsertGrantStmt.run(
      grant.id,
      grant.label,
      grant.type,
      grant.enabled ? 1 : 0,
      stringifyJson(grant.toolsets),
      stringifyJson(grant.toolAllow),
      stringifyJson(grant.toolDeny),
      stringifyJson(grant.scopes),
      grant.expiresAt,
      grant.maxUses,
      stringifyJson(grant.rateLimit),
      stringifyJson(grant.allowedOrigins),
      stringifyJson(grant.allowedCidrs),
      stringifyJson(sanitizeGrantMetadata(grant.metadata)),
      grant.reason,
      grant.tokenHash,
      grant.tokenPrefix,
      grant.tokenFamilyId,
      grant.useCount,
      grant.createdAt,
      grant.updatedAt,
      grant.revokedAt,
      grant.lastUsedAt
    );
    return grant;
  }

  function appendGrantEvent(grantId, eventType, details = {}) {
    db.prepare(`
      INSERT INTO tool_grant_events (event_id, grant_id, event_type, details_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomId("grant_event"), String(grantId || ""), String(eventType || ""), stringifyJson(details), nowIso());
  }

  function getGrant(grantId) {
    return rowToGrant(db.prepare("SELECT * FROM tool_grants WHERE id = ?").get(String(grantId || "")));
  }

  function listGrants({ includeRevoked = false } = {}) {
    const rows = includeRevoked
      ? db.prepare("SELECT * FROM tool_grants ORDER BY created_at DESC").all()
      : db.prepare("SELECT * FROM tool_grants WHERE revoked_at = '' ORDER BY created_at DESC").all();
    return rows.map(rowToGrant).map(publicGrant);
  }

  async function createGrant(input = {}) {
    rejectUnknownGrantCapabilities(input);
    const baseGrant = normalizeGrantInput({
      ...input,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    const capabilities = resolveGrantCapabilities(baseGrant, { registry, capabilityResolver });
    let token = "";
    let credentialMetadata = {};
    if (capabilities.length > 0 && resolvedCapabilityKeyProvider) {
      const issued = await resolvedCapabilityKeyProvider.issue({
        credentialId: baseGrant.id,
        capabilities,
        expiresAt: baseGrant.expiresAt || "9999-12-31T23:59:59.999Z",
        metadata: {
          grantId: baseGrant.id,
          grantType: baseGrant.type
        }
      });
      token = issued.capabilityKey;
      credentialMetadata = credentialMetadataFromIssue(issued);
      if (typeof resolvedCapabilityBindingGuard?.bindCapabilityKey === "function") {
        const binding = await resolvedCapabilityBindingGuard.bindCapabilityKey({
          capabilityKey: token,
          credentialId: baseGrant.id,
          context: bindingContextFromGrant(baseGrant),
          expiresAt: issued.expiresAt || baseGrant.expiresAt || "9999-12-31T23:59:59.999Z"
        });
        credentialMetadata = {
          ...credentialMetadata,
          ...credentialBindingMetadata(binding)
        };
      }
    } else {
      token = createToken();
      credentialMetadata = {
        credentialProtocol: "pact.legacy-token-hash.v1",
        credentialId: baseGrant.id,
        credentialIssuedAt: nowIso()
      };
    }
    const grant = normalizeGrantInput({
      ...baseGrant,
      metadata: {
        ...sanitizeGrantMetadata(baseGrant.metadata),
        ...credentialMetadata
      },
      tokenHash: hashToken(token),
      tokenPrefix: `${token.slice(0, 10)}...`
    });
    upsertGrant(grant);
    appendGrantEvent(grant.id, "created", {
      scopes: grant.scopes,
      credentialProtocol: grant.metadata.credentialProtocol || "",
      capabilitySetHash: grant.metadata.capabilitySetHash || "",
      capabilityCount: grant.metadata.capabilityCount || 0,
      toolsets: grant.toolsets
    });
    return {
      grant: publicGrant(grant),
      token
    };
  }

  function updateGrant(grantId, patch = {}) {
    const existing = getGrant(grantId);
    if (!existing) {
      return null;
    }
    rejectUnknownGrantCapabilities(patch);
    const updated = normalizeGrantInput(
      {
        ...patch,
        id: existing.id,
        tokenHash: existing.tokenHash,
        tokenPrefix: existing.tokenPrefix,
        tokenFamilyId: existing.tokenFamilyId,
        createdAt: existing.createdAt,
        updatedAt: nowIso(),
        useCount: existing.useCount,
        lastUsedAt: existing.lastUsedAt,
        revokedAt: existing.revokedAt
      },
      existing
    );
    upsertGrant(updated);
    appendGrantEvent(updated.id, "updated", { patch: summarizeValue(patch) });
    return publicGrant(updated);
  }

  function deleteGrant(grantId) {
    const existing = getGrant(grantId);
    if (!existing) {
      return false;
    }
    db.prepare("DELETE FROM tool_grants WHERE id = ?").run(existing.id);
    appendGrantEvent(existing.id, "deleted", {});
    return true;
  }

  async function revokeGrant(grantId, reason = "") {
    const existing = getGrant(grantId);
    if (!existing) {
      return null;
    }
    if (typeof resolvedCapabilityKeyProvider?.invalidateCredential === "function") {
      await resolvedCapabilityKeyProvider.invalidateCredential({
        credentialId: existing.id,
        reason: reason || "grant_revoked"
      });
    }
    if (typeof resolvedCapabilityBindingGuard?.invalidateCapabilityKeyBinding === "function") {
      await resolvedCapabilityBindingGuard.invalidateCapabilityKeyBinding({
        credentialId: existing.id,
        reason: reason || "grant_revoked"
      });
    }
    const updated = {
      ...existing,
      enabled: false,
      revokedAt: nowIso(),
      updatedAt: nowIso(),
      reason: reason || existing.reason
    };
    upsertGrant(updated);
    appendGrantEvent(updated.id, "revoked", { reason: updated.reason });
    return publicGrant(updated);
  }

  async function rotateGrantToken(grantId) {
    const existing = getGrant(grantId);
    if (!existing) {
      return null;
    }
    const capabilities = resolveGrantCapabilities(existing, { registry, capabilityResolver });
    if (typeof resolvedCapabilityKeyProvider?.invalidateCredential === "function") {
      await resolvedCapabilityKeyProvider.invalidateCredential({
        credentialId: existing.id,
        reason: "grant_token_rotated"
      });
    }
    if (typeof resolvedCapabilityBindingGuard?.invalidateCapabilityKeyBinding === "function") {
      await resolvedCapabilityBindingGuard.invalidateCapabilityKeyBinding({
        credentialId: existing.id,
        reason: "grant_token_rotated"
      });
    }
    let token = "";
    let credentialMetadata = {};
    if (capabilities.length > 0 && resolvedCapabilityKeyProvider) {
      const issued = await resolvedCapabilityKeyProvider.issue({
        credentialId: existing.id,
        capabilities,
        expiresAt: existing.expiresAt || "9999-12-31T23:59:59.999Z",
        metadata: {
          grantId: existing.id,
          grantType: existing.type
        }
      });
      token = issued.capabilityKey;
      credentialMetadata = credentialMetadataFromIssue(issued);
      if (typeof resolvedCapabilityBindingGuard?.bindCapabilityKey === "function") {
        const binding = await resolvedCapabilityBindingGuard.bindCapabilityKey({
          capabilityKey: token,
          credentialId: existing.id,
          context: bindingContextFromGrant(existing),
          expiresAt: issued.expiresAt || existing.expiresAt || "9999-12-31T23:59:59.999Z"
        });
        credentialMetadata = {
          ...credentialMetadata,
          ...credentialBindingMetadata(binding)
        };
      }
    } else {
      token = createToken();
      credentialMetadata = {
        credentialProtocol: "pact.legacy-token-hash.v1",
        credentialId: existing.id,
        credentialIssuedAt: nowIso()
      };
    }
    const updated = {
      ...existing,
      enabled: true,
      metadata: {
        ...sanitizeGrantMetadata(existing.metadata),
        ...credentialMetadata
      },
      tokenHash: hashToken(token),
      tokenPrefix: `${token.slice(0, 10)}...`,
      tokenFamilyId: randomId("token_family"),
      updatedAt: nowIso(),
      revokedAt: ""
    };
    upsertGrant(updated);
    appendGrantEvent(updated.id, "rotated", { tokenPrefix: updated.tokenPrefix });
    return {
      grant: publicGrant(updated),
      token
    };
  }

  function finishGrantAuthorization({ grant, request, sourceIp = "" }) {
    const resolvedSourceIp = sourceIp || sourceIpFromRequest(request);
    const perMinute = Math.max(0, Number(grant.rateLimit?.perMinute || 0));
    let grantRateLimited = false;
    if (perMinute > 0) {
      const since = new Date(Date.now() - 60_000).toISOString();
      const count = db.prepare(`
        SELECT count(*) AS count FROM tool_metric_events
        WHERE grant_id = ? AND created_at >= ?
      `).get(grant.id, since).count;
      grantRateLimited = count >= perMinute;
    }
    const authorizationDecision = evaluateAuthorizationPolicy({
      operation: {
        id: "tool.grant.authorize",
        requiredScopes: [],
        safety: { risk: "read_only" },
        readOnly: true
      },
      grant: publicGrant(grant),
      request,
      context: {
        grantRateLimited,
        sourceIp: resolvedSourceIp
      },
      grantRequired: true,
      enforceConfirmation: false
    });
    if (!authorizationDecision.allowed) {
      const errorByReason = {
        grant_expired: "工具授权已过期。",
        grant_max_uses: "工具授权已超过最大使用次数。",
        origin_not_allowed: "当前请求来源暂未匹配到该工具的可用授权，请核实授权配置以启用该能力。",
        cidr_not_allowed: "当前网络来源暂未开通访问权限，如需调用请调整授权清单。",
        rate_limited: "工具授权已超过限流阈值。"
      };
      return {
        ok: false,
        status: authorizationDecision.reasonCode === "rate_limited" ? 429 : 403,
        error: errorByReason[authorizationDecision.reasonCode] || "工具授权策略拒绝了该请求。",
        reasonCode: authorizationDecision.reasonCode,
        missingCapabilities: authorizationDecision.missingCapabilities || [],
        missingScopes: authorizationDecision.missingScopes || [],
        grant: publicGrant(grant),
        authorizationDecision
      };
    }
    const usedAt = nowIso();
    const updated = {
      ...grant,
      useCount: grant.useCount + 1,
      lastUsedAt: usedAt,
      updatedAt: grant.updatedAt || usedAt
    };
    upsertGrant(updated);
    return {
      ok: true,
      grant: publicGrant(updated),
      sourceIp: resolvedSourceIp
    };
  }

  async function authorizeOpaqueToolCapability({ token, grant, request, context = {}, tool }) {
    const requiredCapability = toolExecuteCapabilityId(tool.id);
    const credentialDecision = await resolvedCapabilityKeyProvider.verify({
      capabilityKey: token,
      requiredCapability
    });
    if (!credentialDecision.ok) {
      const reasonCode = credentialDecision.reasonCode === "missing_capabilities"
        ? "missing_capabilities"
        : "invalid_token";
      return {
        ok: false,
        status: reasonCode === "missing_capabilities" ? 403 : 401,
        error: reasonCode === "missing_capabilities"
          ? "工具访问密钥缺少执行该工具所需的 Capability。"
          : "工具访问令牌无效或已停用。",
        reasonCode,
        missingCapabilities: credentialDecision.missingCapabilities || [requiredCapability],
        missingScopes: [],
        grant: publicGrant(grant),
        authorizationDecision: credentialDecision
      };
    }
    if (credentialDecision.credentialId && credentialDecision.credentialId !== grant.id) {
      return {
        ok: false,
        status: 401,
        error: "工具访问令牌与授权记录不匹配。",
        reasonCode: "credential_binding_mismatch",
        missingCapabilities: [],
        missingScopes: [],
        grant: publicGrant(grant),
        authorizationDecision: credentialDecision
      };
    }
    if (typeof resolvedCapabilityBindingGuard?.verifyCapabilityKeyBinding === "function") {
      const bindingDecision = await resolvedCapabilityBindingGuard.verifyCapabilityKeyBinding({
        capabilityKey: token,
        credentialId: grant.id,
        context: bindingContextFromRequest({ request, context })
      });
      if (!bindingDecision.ok) {
        return {
          ok: false,
          status: 403,
          error: "工具访问密钥与当前用户或智能体绑定不匹配。",
          reasonCode: bindingDecision.reasonCode || "capability_binding_denied",
          missingCapabilities: [],
          missingScopes: [],
          grant: publicGrant(grant),
          authorizationDecision: bindingDecision
        };
      }
    }
    return finishGrantAuthorization({
      grant,
      request,
      sourceIp: sourceIpFromRequest(request)
    });
  }

  async function authorizeRequest({ request, requiredScopes = [], tool = null, context = {} } = {}) {
    const token = readBearerToken(request);
    if (!token) {
      return {
        ok: false,
        status: 401,
        error: "缺少工具访问令牌。",
        reasonCode: "missing_token"
      };
    }
    const tokenHash = hashToken(token);
    const rows = db.prepare("SELECT * FROM tool_grants WHERE enabled = 1 AND revoked_at = ''").all();
    const grant = rows.map(rowToGrant).find((item) => safeCompare(item.tokenHash, tokenHash));
    if (!grant) {
      return {
        ok: false,
        status: 401,
        error: "工具访问令牌无效或已停用。",
        reasonCode: "invalid_token"
      };
    }
    void requiredScopes;
    if (tool?.id && token.startsWith("ock_")) {
      if (typeof resolvedCapabilityKeyProvider?.verify !== "function") {
        return {
          ok: false,
          status: 503,
          error: "Capability Kernel 不可用，无法验证工具访问密钥。",
          reasonCode: "capability_kernel_unavailable",
          missingCapabilities: [toolExecuteCapabilityId(tool.id)],
          missingScopes: [],
          grant: publicGrant(grant),
          authorizationDecision: {
            ok: false,
            reasonCode: "capability_kernel_unavailable",
            requiredCapabilities: [toolExecuteCapabilityId(tool.id)]
          }
        };
      }
      return authorizeOpaqueToolCapability({ token, grant, request, context, tool });
    }
    return finishGrantAuthorization({
      grant,
      request,
      sourceIp: sourceIpFromRequest(request)
    });
  }

  function appendPolicyDecision(entry = {}) {
    const decisionId = entry.decisionId || randomId("policy");
    db.prepare(`
      INSERT INTO tool_policy_decisions (
        decision_id, tool_execution_id, trace_id, tool_id, grant_id, effect, reason_code,
        missing_scopes_json, missing_toolsets_json, evaluated_layers_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      decisionId,
      String(entry.toolExecutionId || ""),
      String(entry.traceId || ""),
      String(entry.toolId || ""),
      String(entry.grantId || ""),
      String(entry.effect || ""),
      String(entry.reasonCode || ""),
      stringifyJson(entry.missingScopes || []),
      stringifyJson(entry.missingToolsets || []),
      stringifyJson(entry.evaluatedLayers || []),
      entry.createdAt || nowIso()
    );
    return { decisionId };
  }

  function appendExecution(entry = {}) {
    db.prepare(`
      INSERT INTO tool_executions (
        tool_execution_id, trace_id, tool_id, tool_version, toolset_ids_json, subject_type,
        subject_id, grant_id, agent_id, profile_id, operation_id, risk, decision, input_hash,
        redacted_input_json, result_summary_json, status, error_code, duration_ms,
        policy_decision_id, approval_id, source_ip, user_agent, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(entry.toolExecutionId || randomId("tool_exec")),
      String(entry.traceId || ""),
      String(entry.toolId || ""),
      String(entry.toolVersion || ""),
      stringifyJson(entry.toolsetIds || []),
      String(entry.subjectType || ""),
      String(entry.subjectId || ""),
      String(entry.grantId || ""),
      String(entry.agentId || ""),
      String(entry.profileId || ""),
      String(entry.operationId || ""),
      String(entry.risk || ""),
      String(entry.decision || ""),
      String(entry.inputHash || hashValue(entry.input || {})),
      stringifyJson(entry.redactedInput || summarizeValue(entry.input || {})),
      stringifyJson(entry.resultSummary || summarizeValue(entry.result || {})),
      String(entry.status || ""),
      String(entry.errorCode || ""),
      Math.max(0, Number(entry.durationMs || 0)),
      String(entry.policyDecisionId || ""),
      String(entry.approvalId || ""),
      String(entry.sourceIp || ""),
      String(entry.userAgent || ""),
      String(entry.startedAt || nowIso()),
      String(entry.finishedAt || nowIso())
    );
  }

  function appendMetric(entry = {}) {
    const durationMs = Math.max(0, Number(entry.durationMs || 0));
    const inputBytes = Math.max(0, Number(entry.inputBytes || 0));
    const resultBytes = Math.max(0, Number(entry.resultBytes || 0));
    const transferBytes = Math.max(0, Number(entry.transferBytes || inputBytes + resultBytes));
    const bytesPerSecond = durationMs > 0
      ? Number(((transferBytes * 1000) / durationMs).toFixed(2))
      : transferBytes;
    db.prepare(`
      INSERT INTO tool_metric_events (
        metric_id, trace_id, tool_id, grant_id, profile_id, status, risk, duration_ms,
        input_bytes, result_bytes, transfer_bytes, bytes_per_second, reason_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomId("metric"),
      String(entry.traceId || ""),
      String(entry.toolId || ""),
      String(entry.grantId || ""),
      String(entry.profileId || ""),
      String(entry.status || ""),
      String(entry.risk || ""),
      durationMs,
      inputBytes,
      resultBytes,
      transferBytes,
      bytesPerSecond,
      String(entry.reasonCode || ""),
      entry.createdAt || nowIso()
    );
  }

  function appendHttpRequestMetric(entry = {}) {
    const durationMs = Math.max(0, Number(entry.durationMs || 0));
    const requestBytes = Math.max(0, Number(entry.requestBytes || 0));
    const responseBytes = Math.max(0, Number(entry.responseBytes || 0));
    const transferBytes = Math.max(0, Number(entry.transferBytes || requestBytes + responseBytes));
    const bytesPerSecond = durationMs > 0
      ? Number(((transferBytes * 1000) / durationMs).toFixed(2))
      : transferBytes;
    db.prepare(`
      INSERT INTO http_request_metric_events (
        metric_id, trace_id, request_id, transport, method, route, status_code,
        completion_status, request_bytes, response_bytes, transfer_bytes,
        duration_ms, bytes_per_second, user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomId("http_metric"),
      String(entry.traceId || ""),
      String(entry.requestId || ""),
      String(entry.transport || "http"),
      String(entry.method || ""),
      String(entry.route || ""),
      Math.max(0, Number(entry.statusCode || 0)),
      String(entry.completionStatus || "completed"),
      requestBytes,
      responseBytes,
      transferBytes,
      durationMs,
      bytesPerSecond,
      String(entry.userAgent || "").slice(0, 512),
      entry.createdAt || nowIso()
    );
  }

  function saveCatalogSnapshot(catalog = {}) {
    if (!catalog.fingerprint) {
      return null;
    }
    db.prepare(`
      INSERT OR IGNORE INTO tool_catalog_snapshots (fingerprint, catalog_json, created_at)
      VALUES (?, ?, ?)
    `).run(catalog.fingerprint, stringifyJson(catalog), nowIso());
    return { fingerprint: catalog.fingerprint };
  }

  function listAudit({ limit = 100, toolId = "", grantId = "", status = "" } = {}) {
    const clauses = [];
    const params = [];
    if (toolId) {
      clauses.push("tool_id = ?");
      params.push(String(toolId));
    }
    if (grantId) {
      clauses.push("grant_id = ?");
      params.push(String(grantId));
    }
    if (status) {
      clauses.push("status = ?");
      params.push(String(status));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db.prepare(`
      SELECT * FROM tool_executions
      ${where}
      ORDER BY started_at DESC
      LIMIT ?
    `).all(...params, Math.max(1, Math.min(Number(limit || 100), 500)));
    return rows.map((row) => ({
      toolExecutionId: row.tool_execution_id,
      traceId: row.trace_id,
      toolId: row.tool_id,
      toolVersion: row.tool_version,
      toolsetIds: parseJson(row.toolset_ids_json, []),
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      grantId: row.grant_id,
      agentId: row.agent_id,
      profileId: row.profile_id,
      operationId: row.operation_id,
      risk: row.risk,
      decision: row.decision,
      inputHash: row.input_hash,
      redactedInput: parseJson(row.redacted_input_json, {}),
      resultSummary: parseJson(row.result_summary_json, {}),
      status: row.status,
      errorCode: row.error_code,
      durationMs: row.duration_ms,
      policyDecisionId: row.policy_decision_id,
      approvalId: row.approval_id,
      sourceIp: row.source_ip,
      userAgent: row.user_agent,
      startedAt: row.started_at,
      finishedAt: row.finished_at
    }));
  }

  function getAudit(toolExecutionId) {
    const row = db.prepare("SELECT * FROM tool_executions WHERE tool_execution_id = ?").get(String(toolExecutionId || ""));
    if (!row) {
      return null;
    }
    return {
      toolExecutionId: row.tool_execution_id,
      traceId: row.trace_id,
      toolId: row.tool_id,
      toolVersion: row.tool_version,
      toolsetIds: parseJson(row.toolset_ids_json, []),
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      grantId: row.grant_id,
      agentId: row.agent_id,
      profileId: row.profile_id,
      operationId: row.operation_id,
      risk: row.risk,
      decision: row.decision,
      inputHash: row.input_hash,
      redactedInput: parseJson(row.redacted_input_json, {}),
      resultSummary: parseJson(row.result_summary_json, {}),
      status: row.status,
      errorCode: row.error_code,
      durationMs: row.duration_ms,
      policyDecisionId: row.policy_decision_id,
      approvalId: row.approval_id,
      sourceIp: row.source_ip,
      userAgent: row.user_agent,
      startedAt: row.started_at,
      finishedAt: row.finished_at
    };
  }

  function metricsSummary({
    limit = 2000,
    since = "",
    until = "",
    toolId = "",
    grantId = "",
    profileId = "",
    route = "",
    transport = "",
    status = "",
    statusCode = "",
    completionStatus = "",
    bucketSeconds = 0
  } = {}) {
    const normalizedLimit = normalizeMetricLimit(limit);
    const normalizedBucketSeconds = normalizeBucketSeconds(bucketSeconds);
    const toolFilters = createMetricClauses({ since, until, toolId, grantId, profileId, status }, "tool");
    const requestFilters = createMetricClauses({
      since,
      until,
      route,
      transport,
      status,
      statusCode,
      completionStatus
    }, "request");
    const rows = db.prepare(`
      SELECT * FROM tool_metric_events
      ${toolFilters.clauses.length ? `WHERE ${toolFilters.clauses.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...toolFilters.params, normalizedLimit);
    const byStatus = {};
    const byTool = {};
    const byProfile = {};
    const byGrant = {};
    const byRisk = {};
    const deniedByReason = {};
    let durationTotal = 0;
    let inputBytesTotal = 0;
    let resultBytesTotal = 0;
    let transferBytesTotal = 0;
    let byteRateTotal = 0;
    let peakBytesPerSecond = 0;
    let timeoutTotal = 0;
    let rateLimitedTotal = 0;
    for (const row of rows) {
      byStatus[row.status] = (byStatus[row.status] || 0) + 1;
      byTool[row.tool_id] = (byTool[row.tool_id] || 0) + 1;
      if (row.profile_id) {
        byProfile[row.profile_id] = (byProfile[row.profile_id] || 0) + 1;
      }
      if (row.grant_id) {
        byGrant[row.grant_id] = (byGrant[row.grant_id] || 0) + 1;
      }
      if (row.risk) {
        byRisk[row.risk] = (byRisk[row.risk] || 0) + 1;
      }
      if (row.status === "denied") {
        deniedByReason[row.reason_code || "unknown"] = (deniedByReason[row.reason_code || "unknown"] || 0) + 1;
      }
      if (row.reason_code === "tool_timeout") {
        timeoutTotal += 1;
      }
      if (row.reason_code === "rate_limited") {
        rateLimitedTotal += 1;
      }
      const durationMs = Number(row.duration_ms || 0);
      const inputBytes = Number(row.input_bytes || 0);
      const resultBytes = Number(row.result_bytes || 0);
      const transferBytes = Number(row.transfer_bytes || inputBytes + resultBytes);
      const bytesPerSecond = Number(row.bytes_per_second || 0);
      durationTotal += durationMs;
      inputBytesTotal += inputBytes;
      resultBytesTotal += resultBytes;
      transferBytesTotal += transferBytes;
      byteRateTotal += bytesPerSecond;
      peakBytesPerSecond = Math.max(peakBytesPerSecond, bytesPerSecond);
    }
    const requestRows = db.prepare(`
      SELECT * FROM http_request_metric_events
      ${requestFilters.clauses.length ? `WHERE ${requestFilters.clauses.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...requestFilters.params, normalizedLimit);
    const requests = summarizeRequestMetricRows(requestRows);
    const activeExecutions = db.prepare("SELECT count(*) AS count FROM tool_executions WHERE status = 'running'").get().count;
    const toolCalls = {
      total: rows.length,
      byStatus,
      byTool,
      byProfile,
      byGrant,
      usageByGrant: summarizeToolUsageDimension(rows, "grant_id", "grantId"),
      usageByProfile: summarizeToolUsageDimension(rows, "profile_id", "profileId"),
      byRisk,
      deniedByReason,
      timeoutTotal,
      rateLimitedTotal,
      activeExecutions,
      averageDurationMs: rows.length ? Number((durationTotal / rows.length).toFixed(2)) : 0,
      inputBytesTotal,
      resultBytesTotal,
      transferBytesTotal,
      averageBytesPerSecond: rows.length ? Number((byteRateTotal / rows.length).toFixed(2)) : 0,
      peakBytesPerSecond
    };
    return {
      filters: {
        limit: normalizedLimit,
        since: String(since || ""),
        until: String(until || ""),
        toolId: String(toolId || ""),
        grantId: String(grantId || ""),
        profileId: String(profileId || ""),
        route: String(route || ""),
        transport: String(transport || ""),
        status: String(status || ""),
        statusCode: String(statusCode || ""),
        completionStatus: String(completionStatus || ""),
        bucketSeconds: normalizedBucketSeconds
      },
      callsTotal: rows.length,
      byStatus,
      byTool,
      byProfile,
      byGrant,
      byRisk,
      deniedByReason,
      timeoutTotal,
      rateLimitedTotal,
      activeExecutions,
      averageDurationMs: rows.length ? Number((durationTotal / rows.length).toFixed(2)) : 0,
      inputBytesTotal,
      resultBytesTotal,
      transferBytesTotal,
      averageBytesPerSecond: rows.length ? Number((byteRateTotal / rows.length).toFixed(2)) : 0,
      peakBytesPerSecond,
      toolCalls,
      requests,
      series: summarizeMetricBuckets({
        toolRows: rows,
        requestRows,
        bucketSeconds: normalizedBucketSeconds
      })
    };
  }

  function metricsExport({
    limit = 2000,
    since = "",
    until = "",
    kind = "all",
    toolId = "",
    grantId = "",
    profileId = "",
    route = "",
    transport = "",
    status = "",
    statusCode = "",
    completionStatus = ""
  } = {}) {
    const normalizedLimit = normalizeMetricLimit(limit);
    const normalizedKind = normalizeMetricExportKind(kind);
    const includeTools = normalizedKind === "all" || normalizedKind === "tool";
    const includeRequests = normalizedKind === "all" || normalizedKind === "request";
    const toolFilters = createMetricClauses({ since, until, toolId, grantId, profileId, status }, "tool");
    const requestFilters = createMetricClauses({
      since,
      until,
      route,
      transport,
      status,
      statusCode,
      completionStatus
    }, "request");
    const toolMetricEvents = includeTools
      ? db.prepare(`
          SELECT * FROM tool_metric_events
          ${toolFilters.clauses.length ? `WHERE ${toolFilters.clauses.join(" AND ")}` : ""}
          ORDER BY created_at DESC
          LIMIT ?
        `).all(...toolFilters.params, normalizedLimit).map(rowToToolMetricEvent)
      : [];
    const httpRequestMetricEvents = includeRequests
      ? db.prepare(`
          SELECT * FROM http_request_metric_events
          ${requestFilters.clauses.length ? `WHERE ${requestFilters.clauses.join(" AND ")}` : ""}
          ORDER BY created_at DESC
          LIMIT ?
        `).all(...requestFilters.params, normalizedLimit).map(rowToHttpRequestMetricEvent)
      : [];
    return {
      schemaVersion: "pact.tool-management.metrics-export.v1",
      generatedAt: nowIso(),
      filters: {
        limit: normalizedLimit,
        since: String(since || ""),
        until: String(until || ""),
        kind: normalizedKind,
        toolId: String(toolId || ""),
        grantId: String(grantId || ""),
        profileId: String(profileId || ""),
        route: String(route || ""),
        transport: String(transport || ""),
        status: String(status || ""),
        statusCode: String(statusCode || ""),
        completionStatus: String(completionStatus || "")
      },
      counts: {
        toolMetricEvents: toolMetricEvents.length,
        httpRequestMetricEvents: httpRequestMetricEvents.length,
        total: toolMetricEvents.length + httpRequestMetricEvents.length
      },
      toolMetricEvents,
      httpRequestMetricEvents
    };
  }

  function metricsHealth({
    windowSeconds = 300,
    maxRequestErrorRate = 0.05,
    maxToolFailureRate = 0.05,
    maxDeniedRate = 0.2,
    maxRequestP95Ms = 0,
    maxToolP95Ms = 0,
    minRequests = 0
  } = {}) {
    const normalizedWindowSeconds = normalizeMetricWindowSeconds(windowSeconds);
    const thresholds = {
      maxRequestErrorRate: normalizeMetricThreshold(maxRequestErrorRate, 0.05),
      maxToolFailureRate: normalizeMetricThreshold(maxToolFailureRate, 0.05),
      maxDeniedRate: normalizeMetricThreshold(maxDeniedRate, 0.2),
      maxRequestP95Ms: normalizeMetricDurationThreshold(maxRequestP95Ms, 0),
      maxToolP95Ms: normalizeMetricDurationThreshold(maxToolP95Ms, 0),
      minRequests: Math.max(0, Math.floor(Number(minRequests || 0) || 0))
    };
    const endedAt = nowIso();
    const startedAt = new Date(Date.now() - normalizedWindowSeconds * 1000).toISOString();
    const toolRow = db.prepare(`
      SELECT
        count(*) AS total,
        coalesce(sum(CASE WHEN status = 'ok' THEN 1 ELSE 0 END), 0) AS ok_total,
        coalesce(sum(CASE WHEN status = 'denied' THEN 1 ELSE 0 END), 0) AS denied_total,
        coalesce(sum(CASE WHEN status != 'ok' THEN 1 ELSE 0 END), 0) AS failure_total,
        coalesce(sum(CASE WHEN reason_code = 'tool_timeout' THEN 1 ELSE 0 END), 0) AS timeout_total,
        coalesce(sum(CASE WHEN reason_code = 'rate_limited' THEN 1 ELSE 0 END), 0) AS rate_limited_total,
        coalesce(sum(input_bytes), 0) AS input_bytes_total,
        coalesce(sum(result_bytes), 0) AS result_bytes_total,
        coalesce(sum(transfer_bytes), 0) AS transfer_bytes_total,
        coalesce(avg(duration_ms), 0) AS average_duration_ms,
        coalesce(avg(bytes_per_second), 0) AS average_bytes_per_second,
        coalesce(max(bytes_per_second), 0) AS peak_bytes_per_second
      FROM tool_metric_events
      WHERE created_at >= ? AND created_at <= ?
    `).get(startedAt, endedAt);
    const requestRow = db.prepare(`
      SELECT
        count(*) AS total,
        coalesce(sum(CASE WHEN status_code >= 200 AND status_code < 400 THEN 1 ELSE 0 END), 0) AS success_total,
        coalesce(sum(CASE WHEN status_code >= 400 AND status_code < 500 THEN 1 ELSE 0 END), 0) AS client_error_total,
        coalesce(sum(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END), 0) AS server_error_total,
        coalesce(sum(CASE WHEN completion_status != 'completed' THEN 1 ELSE 0 END), 0) AS completion_failure_total,
        coalesce(sum(request_bytes), 0) AS request_bytes_total,
        coalesce(sum(response_bytes), 0) AS response_bytes_total,
        coalesce(sum(transfer_bytes), 0) AS transfer_bytes_total,
        coalesce(avg(duration_ms), 0) AS average_duration_ms,
        coalesce(avg(bytes_per_second), 0) AS average_bytes_per_second,
        coalesce(max(bytes_per_second), 0) AS peak_bytes_per_second
      FROM http_request_metric_events
      WHERE created_at >= ? AND created_at <= ?
    `).get(startedAt, endedAt);
    const toolDurationPercentiles = durationPercentilesFromRows(db.prepare(`
      SELECT duration_ms
      FROM tool_metric_events
      WHERE created_at >= ? AND created_at <= ?
      ORDER BY duration_ms ASC
    `).all(startedAt, endedAt));
    const requestDurationPercentiles = durationPercentilesFromRows(db.prepare(`
      SELECT duration_ms
      FROM http_request_metric_events
      WHERE created_at >= ? AND created_at <= ?
      ORDER BY duration_ms ASC
    `).all(startedAt, endedAt));
    const topTools = db.prepare(`
      SELECT
        tool_id,
        count(*) AS total,
        coalesce(sum(transfer_bytes), 0) AS transfer_bytes_total,
        coalesce(avg(duration_ms), 0) AS average_duration_ms
      FROM tool_metric_events
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY tool_id
      ORDER BY total DESC, transfer_bytes_total DESC
      LIMIT 10
    `).all(startedAt, endedAt).map((row) => {
      const transferBytesTotal = Number(row.transfer_bytes_total || 0);
      return {
        toolId: row.tool_id,
        total: Number(row.total || 0),
        transferBytesTotal,
        transferBytesPerSecond: Number((transferBytesTotal / normalizedWindowSeconds).toFixed(2)),
        averageDurationMs: Number(Number(row.average_duration_ms || 0).toFixed(2)),
        durationPercentiles: durationPercentilesFromRows(db.prepare(`
          SELECT duration_ms
          FROM tool_metric_events
          WHERE created_at >= ? AND created_at <= ? AND tool_id = ?
          ORDER BY duration_ms ASC
        `).all(startedAt, endedAt, row.tool_id))
      };
    });
    const topRoutes = db.prepare(`
      SELECT
        transport,
        method,
        route,
        count(*) AS total,
        coalesce(sum(transfer_bytes), 0) AS transfer_bytes_total,
        coalesce(avg(duration_ms), 0) AS average_duration_ms
      FROM http_request_metric_events
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY transport, method, route
      ORDER BY total DESC, transfer_bytes_total DESC
      LIMIT 10
    `).all(startedAt, endedAt).map((row) => {
      const transferBytesTotal = Number(row.transfer_bytes_total || 0);
      return {
        transport: row.transport,
        method: row.method,
        route: row.route,
        total: Number(row.total || 0),
        transferBytesTotal,
        transferBytesPerSecond: Number((transferBytesTotal / normalizedWindowSeconds).toFixed(2)),
        averageDurationMs: Number(Number(row.average_duration_ms || 0).toFixed(2)),
        durationPercentiles: durationPercentilesFromRows(db.prepare(`
          SELECT duration_ms
          FROM http_request_metric_events
          WHERE created_at >= ? AND created_at <= ? AND transport = ? AND method = ? AND route = ?
          ORDER BY duration_ms ASC
        `).all(startedAt, endedAt, row.transport, row.method, row.route))
      };
    });

    const toolTotal = Number(toolRow.total || 0);
    const requestTotal = Number(requestRow.total || 0);
    const toolCalls = {
      total: toolTotal,
      okTotal: Number(toolRow.ok_total || 0),
      deniedTotal: Number(toolRow.denied_total || 0),
      failureTotal: Number(toolRow.failure_total || 0),
      timeoutTotal: Number(toolRow.timeout_total || 0),
      rateLimitedTotal: Number(toolRow.rate_limited_total || 0),
      callsPerMinute: Number(((toolTotal * 60) / normalizedWindowSeconds).toFixed(2)),
      failureRate: ratio(toolRow.failure_total, toolTotal),
      deniedRate: ratio(toolRow.denied_total, toolTotal),
      inputBytesTotal: Number(toolRow.input_bytes_total || 0),
      resultBytesTotal: Number(toolRow.result_bytes_total || 0),
      transferBytesTotal: Number(toolRow.transfer_bytes_total || 0),
      transferBytesPerSecond: Number((Number(toolRow.transfer_bytes_total || 0) / normalizedWindowSeconds).toFixed(2)),
      averageDurationMs: Number(Number(toolRow.average_duration_ms || 0).toFixed(2)),
      durationPercentiles: toolDurationPercentiles,
      averageBytesPerSecond: Number(Number(toolRow.average_bytes_per_second || 0).toFixed(2)),
      peakBytesPerSecond: Number(toolRow.peak_bytes_per_second || 0),
      topTools
    };
    const requests = {
      total: requestTotal,
      successTotal: Number(requestRow.success_total || 0),
      clientErrorTotal: Number(requestRow.client_error_total || 0),
      serverErrorTotal: Number(requestRow.server_error_total || 0),
      completionFailureTotal: Number(requestRow.completion_failure_total || 0),
      requestsPerMinute: Number(((requestTotal * 60) / normalizedWindowSeconds).toFixed(2)),
      serverErrorRate: ratio(requestRow.server_error_total, requestTotal),
      clientErrorRate: ratio(requestRow.client_error_total, requestTotal),
      completionFailureRate: ratio(requestRow.completion_failure_total, requestTotal),
      requestBytesTotal: Number(requestRow.request_bytes_total || 0),
      responseBytesTotal: Number(requestRow.response_bytes_total || 0),
      transferBytesTotal: Number(requestRow.transfer_bytes_total || 0),
      transferBytesPerSecond: Number((Number(requestRow.transfer_bytes_total || 0) / normalizedWindowSeconds).toFixed(2)),
      averageDurationMs: Number(Number(requestRow.average_duration_ms || 0).toFixed(2)),
      durationPercentiles: requestDurationPercentiles,
      averageBytesPerSecond: Number(Number(requestRow.average_bytes_per_second || 0).toFixed(2)),
      peakBytesPerSecond: Number(requestRow.peak_bytes_per_second || 0),
      topRoutes
    };
    const breaches = [];
    if (thresholds.minRequests && requestTotal < thresholds.minRequests) {
      breaches.push({
        code: "request_volume_low",
        severity: "warn",
        observed: requestTotal,
        threshold: thresholds.minRequests
      });
    }
    if (requests.serverErrorRate > thresholds.maxRequestErrorRate) {
      breaches.push({
        code: "request_server_error_rate",
        severity: "critical",
        observed: requests.serverErrorRate,
        threshold: thresholds.maxRequestErrorRate
      });
    }
    if (requests.completionFailureRate > thresholds.maxRequestErrorRate) {
      breaches.push({
        code: "request_completion_failure_rate",
        severity: "critical",
        observed: requests.completionFailureRate,
        threshold: thresholds.maxRequestErrorRate
      });
    }
    if (thresholds.maxRequestP95Ms > 0 && requests.durationPercentiles.p95Ms > thresholds.maxRequestP95Ms) {
      breaches.push({
        code: "request_p95_duration_ms",
        severity: "warn",
        observed: requests.durationPercentiles.p95Ms,
        threshold: thresholds.maxRequestP95Ms
      });
    }
    if (toolCalls.failureRate > thresholds.maxToolFailureRate) {
      breaches.push({
        code: "tool_failure_rate",
        severity: "critical",
        observed: toolCalls.failureRate,
        threshold: thresholds.maxToolFailureRate
      });
    }
    if (toolCalls.deniedRate > thresholds.maxDeniedRate) {
      breaches.push({
        code: "tool_denied_rate",
        severity: "warn",
        observed: toolCalls.deniedRate,
        threshold: thresholds.maxDeniedRate
      });
    }
    if (thresholds.maxToolP95Ms > 0 && toolCalls.durationPercentiles.p95Ms > thresholds.maxToolP95Ms) {
      breaches.push({
        code: "tool_p95_duration_ms",
        severity: "warn",
        observed: toolCalls.durationPercentiles.p95Ms,
        threshold: thresholds.maxToolP95Ms
      });
    }
    const status = breaches.some((breach) => breach.severity === "critical")
      ? "critical"
      : breaches.length
        ? "warn"
        : "ok";
    return {
      schemaVersion: "pact.tool-management.metrics-health.v1",
      generatedAt: endedAt,
      status,
      window: {
        startedAt,
        endedAt,
        windowSeconds: normalizedWindowSeconds
      },
      thresholds,
      requests,
      toolCalls,
      breaches
    };
  }

  function metricsPrometheus(options = {}) {
    const health = metricsHealth(options);
    const lines = [
      "# HELP pact_tool_management_window_seconds Metrics aggregation window in seconds.",
      "# TYPE pact_tool_management_window_seconds gauge",
      prometheusSample("pact_tool_management_window_seconds", health.window.windowSeconds),
      "# HELP pact_tool_management_health_status Health status as one-hot gauges by status label.",
      "# TYPE pact_tool_management_health_status gauge",
      ...["ok", "warn", "critical"].map((status) =>
        prometheusSample("pact_tool_management_health_status", health.status === status ? 1 : 0, { status })
      ),
      "# HELP pact_tool_management_health_breaches_total Number of active health threshold breaches.",
      "# TYPE pact_tool_management_health_breaches_total gauge",
      prometheusSample("pact_tool_management_health_breaches_total", health.breaches.length),
      "# HELP pact_tool_management_requests_total HTTP request metric events in the window.",
      "# TYPE pact_tool_management_requests_total gauge",
      prometheusSample("pact_tool_management_requests_total", health.requests.total),
      prometheusSample("pact_tool_management_requests_success_total", health.requests.successTotal),
      prometheusSample("pact_tool_management_requests_client_error_total", health.requests.clientErrorTotal),
      prometheusSample("pact_tool_management_requests_server_error_total", health.requests.serverErrorTotal),
      prometheusSample(
        "pact_tool_management_requests_completion_failure_total",
        health.requests.completionFailureTotal
      ),
      "# HELP pact_tool_management_requests_per_minute HTTP request rate in the window.",
      "# TYPE pact_tool_management_requests_per_minute gauge",
      prometheusSample("pact_tool_management_requests_per_minute", health.requests.requestsPerMinute),
      "# HELP pact_tool_management_request_error_rate HTTP request error ratios in the window.",
      "# TYPE pact_tool_management_request_error_rate gauge",
      prometheusSample("pact_tool_management_request_error_rate", health.requests.serverErrorRate, {
        kind: "server"
      }),
      prometheusSample("pact_tool_management_request_error_rate", health.requests.clientErrorRate, {
        kind: "client"
      }),
      prometheusSample("pact_tool_management_request_error_rate", health.requests.completionFailureRate, {
        kind: "completion"
      }),
      "# HELP pact_tool_management_request_transfer_bytes_total HTTP request and response transfer bytes.",
      "# TYPE pact_tool_management_request_transfer_bytes_total gauge",
      prometheusSample(
        "pact_tool_management_request_transfer_bytes_total",
        health.requests.transferBytesTotal
      ),
      "# HELP pact_tool_management_request_transfer_bytes_per_second HTTP transfer byte rate.",
      "# TYPE pact_tool_management_request_transfer_bytes_per_second gauge",
      prometheusSample(
        "pact_tool_management_request_transfer_bytes_per_second",
        health.requests.transferBytesPerSecond
      ),
      "# HELP pact_tool_management_request_duration_ms HTTP request duration quantiles in milliseconds.",
      "# TYPE pact_tool_management_request_duration_ms gauge",
      prometheusSample("pact_tool_management_request_duration_ms", health.requests.durationPercentiles.p50Ms, {
        quantile: "0.5"
      }),
      prometheusSample("pact_tool_management_request_duration_ms", health.requests.durationPercentiles.p95Ms, {
        quantile: "0.95"
      }),
      prometheusSample("pact_tool_management_request_duration_ms", health.requests.durationPercentiles.p99Ms, {
        quantile: "0.99"
      }),
      "# HELP pact_tool_management_tool_calls_total Tool call metric events in the window.",
      "# TYPE pact_tool_management_tool_calls_total gauge",
      prometheusSample("pact_tool_management_tool_calls_total", health.toolCalls.total),
      prometheusSample("pact_tool_management_tool_calls_ok_total", health.toolCalls.okTotal),
      prometheusSample("pact_tool_management_tool_calls_denied_total", health.toolCalls.deniedTotal),
      prometheusSample("pact_tool_management_tool_calls_failure_total", health.toolCalls.failureTotal),
      prometheusSample("pact_tool_management_tool_calls_timeout_total", health.toolCalls.timeoutTotal),
      prometheusSample(
        "pact_tool_management_tool_calls_rate_limited_total",
        health.toolCalls.rateLimitedTotal
      ),
      "# HELP pact_tool_management_tool_calls_per_minute Tool call rate in the window.",
      "# TYPE pact_tool_management_tool_calls_per_minute gauge",
      prometheusSample("pact_tool_management_tool_calls_per_minute", health.toolCalls.callsPerMinute),
      "# HELP pact_tool_management_tool_call_rate Tool call failure and denial ratios.",
      "# TYPE pact_tool_management_tool_call_rate gauge",
      prometheusSample("pact_tool_management_tool_call_rate", health.toolCalls.failureRate, {
        kind: "failure"
      }),
      prometheusSample("pact_tool_management_tool_call_rate", health.toolCalls.deniedRate, {
        kind: "denied"
      }),
      "# HELP pact_tool_management_tool_transfer_bytes_total Tool input and result transfer bytes.",
      "# TYPE pact_tool_management_tool_transfer_bytes_total gauge",
      prometheusSample("pact_tool_management_tool_transfer_bytes_total", health.toolCalls.transferBytesTotal),
      "# HELP pact_tool_management_tool_transfer_bytes_per_second Tool transfer byte rate.",
      "# TYPE pact_tool_management_tool_transfer_bytes_per_second gauge",
      prometheusSample(
        "pact_tool_management_tool_transfer_bytes_per_second",
        health.toolCalls.transferBytesPerSecond
      ),
      "# HELP pact_tool_management_tool_call_duration_ms Tool call duration quantiles in milliseconds.",
      "# TYPE pact_tool_management_tool_call_duration_ms gauge",
      prometheusSample("pact_tool_management_tool_call_duration_ms", health.toolCalls.durationPercentiles.p50Ms, {
        quantile: "0.5"
      }),
      prometheusSample("pact_tool_management_tool_call_duration_ms", health.toolCalls.durationPercentiles.p95Ms, {
        quantile: "0.95"
      }),
      prometheusSample("pact_tool_management_tool_call_duration_ms", health.toolCalls.durationPercentiles.p99Ms, {
        quantile: "0.99"
      }),
      "# HELP pact_tool_management_top_tool_calls_total Top tool calls by tool id.",
      "# TYPE pact_tool_management_top_tool_calls_total gauge",
      ...health.toolCalls.topTools.map((item) =>
        prometheusSample("pact_tool_management_top_tool_calls_total", item.total, { tool_id: item.toolId })
      ),
      "# HELP pact_tool_management_top_tool_transfer_bytes_total Top tool transfer bytes by tool id.",
      "# TYPE pact_tool_management_top_tool_transfer_bytes_total gauge",
      ...health.toolCalls.topTools.map((item) =>
        prometheusSample("pact_tool_management_top_tool_transfer_bytes_total", item.transferBytesTotal, {
          tool_id: item.toolId
        })
      ),
      "# HELP pact_tool_management_top_tool_transfer_bytes_per_second Top tool transfer byte rate by tool id.",
      "# TYPE pact_tool_management_top_tool_transfer_bytes_per_second gauge",
      ...health.toolCalls.topTools.map((item) =>
        prometheusSample("pact_tool_management_top_tool_transfer_bytes_per_second", item.transferBytesPerSecond, {
          tool_id: item.toolId
        })
      ),
      "# HELP pact_tool_management_top_tool_duration_ms Top tool p95 duration in milliseconds by tool id.",
      "# TYPE pact_tool_management_top_tool_duration_ms gauge",
      ...health.toolCalls.topTools.map((item) =>
        prometheusSample("pact_tool_management_top_tool_duration_ms", item.durationPercentiles.p95Ms, {
          tool_id: item.toolId,
          quantile: "0.95"
        })
      ),
      "# HELP pact_tool_management_top_route_requests_total Top request counts by route.",
      "# TYPE pact_tool_management_top_route_requests_total gauge",
      ...health.requests.topRoutes.map((item) =>
        prometheusSample("pact_tool_management_top_route_requests_total", item.total, {
          transport: item.transport,
          method: item.method,
          route: item.route
        })
      ),
      "# HELP pact_tool_management_top_route_transfer_bytes_total Top route transfer bytes.",
      "# TYPE pact_tool_management_top_route_transfer_bytes_total gauge",
      ...health.requests.topRoutes.map((item) =>
        prometheusSample("pact_tool_management_top_route_transfer_bytes_total", item.transferBytesTotal, {
          transport: item.transport,
          method: item.method,
          route: item.route
        })
      ),
      "# HELP pact_tool_management_top_route_transfer_bytes_per_second Top route transfer byte rate.",
      "# TYPE pact_tool_management_top_route_transfer_bytes_per_second gauge",
      ...health.requests.topRoutes.map((item) =>
        prometheusSample("pact_tool_management_top_route_transfer_bytes_per_second", item.transferBytesPerSecond, {
          transport: item.transport,
          method: item.method,
          route: item.route
        })
      ),
      "# HELP pact_tool_management_top_route_duration_ms Top route p95 duration in milliseconds.",
      "# TYPE pact_tool_management_top_route_duration_ms gauge",
      ...health.requests.topRoutes.map((item) =>
        prometheusSample("pact_tool_management_top_route_duration_ms", item.durationPercentiles.p95Ms, {
          transport: item.transport,
          method: item.method,
          route: item.route,
          quantile: "0.95"
        })
      )
    ];
    return `${lines.join("\n")}\n`;
  }

  function metricTableStorageSummary(kind) {
    if (kind === "tool") {
      const row = db.prepare(`
        SELECT
          count(*) AS rows,
          min(created_at) AS oldest_created_at,
          max(created_at) AS newest_created_at,
          coalesce(sum(input_bytes), 0) AS input_bytes_total,
          coalesce(sum(result_bytes), 0) AS result_bytes_total,
          coalesce(sum(transfer_bytes), 0) AS transfer_bytes_total,
          coalesce(avg(bytes_per_second), 0) AS average_bytes_per_second,
          coalesce(max(bytes_per_second), 0) AS peak_bytes_per_second
        FROM tool_metric_events
      `).get();
      const rows = Number(row.rows || 0);
      const observedWindowSeconds = metricWindowSeconds(row.oldest_created_at, row.newest_created_at, rows);
      const transferBytesTotal = Number(row.transfer_bytes_total || 0);
      return {
        tableName: "tool_metric_events",
        rows,
        oldestCreatedAt: row.oldest_created_at || "",
        newestCreatedAt: row.newest_created_at || "",
        observedWindowSeconds,
        eventsPerMinute: observedWindowSeconds ? Number(((rows * 60) / observedWindowSeconds).toFixed(2)) : 0,
        inputBytesTotal: Number(row.input_bytes_total || 0),
        resultBytesTotal: Number(row.result_bytes_total || 0),
        transferBytesTotal,
        observedTransferBytesPerSecond: observedWindowSeconds
          ? Number((transferBytesTotal / observedWindowSeconds).toFixed(2))
          : 0,
        averageBytesPerSecond: Number(Number(row.average_bytes_per_second || 0).toFixed(2)),
        peakBytesPerSecond: Number(row.peak_bytes_per_second || 0)
      };
    }

    if (kind === "request") {
      const row = db.prepare(`
        SELECT
          count(*) AS rows,
          min(created_at) AS oldest_created_at,
          max(created_at) AS newest_created_at,
          coalesce(sum(request_bytes), 0) AS request_bytes_total,
          coalesce(sum(response_bytes), 0) AS response_bytes_total,
          coalesce(sum(transfer_bytes), 0) AS transfer_bytes_total,
          coalesce(avg(bytes_per_second), 0) AS average_bytes_per_second,
          coalesce(max(bytes_per_second), 0) AS peak_bytes_per_second
        FROM http_request_metric_events
      `).get();
      const rows = Number(row.rows || 0);
      const observedWindowSeconds = metricWindowSeconds(row.oldest_created_at, row.newest_created_at, rows);
      const transferBytesTotal = Number(row.transfer_bytes_total || 0);
      return {
        tableName: "http_request_metric_events",
        rows,
        oldestCreatedAt: row.oldest_created_at || "",
        newestCreatedAt: row.newest_created_at || "",
        observedWindowSeconds,
        eventsPerMinute: observedWindowSeconds ? Number(((rows * 60) / observedWindowSeconds).toFixed(2)) : 0,
        requestBytesTotal: Number(row.request_bytes_total || 0),
        responseBytesTotal: Number(row.response_bytes_total || 0),
        transferBytesTotal,
        observedTransferBytesPerSecond: observedWindowSeconds
          ? Number((transferBytesTotal / observedWindowSeconds).toFixed(2))
          : 0,
        averageBytesPerSecond: Number(Number(row.average_bytes_per_second || 0).toFixed(2)),
        peakBytesPerSecond: Number(row.peak_bytes_per_second || 0)
      };
    }

    throw new Error("Unknown metric storage table kind.");
  }

  function metricsStorageSummary() {
    const databasePath = getToolManagementDatabasePath(userDataPath);
    const databaseBytes = safeFileSize(databasePath);
    const walBytes = safeFileSize(`${databasePath}-wal`);
    const shmBytes = safeFileSize(`${databasePath}-shm`);
    const toolMetricEvents = metricTableStorageSummary("tool");
    const httpRequestMetricEvents = metricTableStorageSummary("request");
    const metricRows = toolMetricEvents.rows + httpRequestMetricEvents.rows;
    const transferBytesTotal = toolMetricEvents.transferBytesTotal + httpRequestMetricEvents.transferBytesTotal;
    return {
      schemaVersion: "pact.tool-management.metrics-storage.v1",
      generatedAt: nowIso(),
      database: {
        fileName: path.basename(databasePath),
        bytes: databaseBytes,
        walBytes,
        shmBytes,
        totalBytes: databaseBytes + walBytes + shmBytes
      },
      tables: {
        toolMetricEvents,
        httpRequestMetricEvents
      },
      totals: {
        metricRows,
        transferBytesTotal,
        observedTransferBytesPerSecond: Number((
          toolMetricEvents.observedTransferBytesPerSecond +
          httpRequestMetricEvents.observedTransferBytesPerSecond
        ).toFixed(2))
      }
    };
  }

  function pruneMetrics({
    olderThan = "",
    retentionDays = 0,
    maxRows = 0,
    maxToolMetricRows = 0,
    maxHttpRequestMetricRows = 0,
    dryRun = false
  } = {}) {
    const cutoff = retentionCutoffIso({ olderThan, retentionDays });
    const normalizedMaxRows = normalizeMetricMaxRows(maxRows);
    const normalizedMaxToolMetricRows = normalizeMetricMaxRows(maxToolMetricRows) || normalizedMaxRows;
    const normalizedMaxHttpRequestMetricRows = normalizeMetricMaxRows(maxHttpRequestMetricRows) || normalizedMaxRows;

    const before = {
      toolMetrics: db.prepare("SELECT count(*) AS count FROM tool_metric_events").get().count,
      httpRequestMetrics: db.prepare("SELECT count(*) AS count FROM http_request_metric_events").get().count
    };
    const cutoffCounts = cutoff
      ? {
          toolMetrics: db.prepare("SELECT count(*) AS count FROM tool_metric_events WHERE created_at < ?").get(cutoff).count,
          httpRequestMetrics: db.prepare("SELECT count(*) AS count FROM http_request_metric_events WHERE created_at < ?").get(cutoff).count
        }
      : { toolMetrics: 0, httpRequestMetrics: 0 };
    const maxRowCounts = {
      toolMetrics: normalizedMaxToolMetricRows
        ? Math.max(0, before.toolMetrics - normalizedMaxToolMetricRows)
        : 0,
      httpRequestMetrics: normalizedMaxHttpRequestMetricRows
        ? Math.max(0, before.httpRequestMetrics - normalizedMaxHttpRequestMetricRows)
        : 0
    };
    const planned = {
      toolMetrics: Math.max(cutoffCounts.toolMetrics, maxRowCounts.toolMetrics),
      httpRequestMetrics: Math.max(cutoffCounts.httpRequestMetrics, maxRowCounts.httpRequestMetrics)
    };

    let deletedToolMetrics = 0;
    let deletedHttpRequestMetrics = 0;
    if (!dryRun) {
      const run = db.transaction(() => {
        if (cutoff) {
          deletedToolMetrics += db.prepare("DELETE FROM tool_metric_events WHERE created_at < ?").run(cutoff).changes;
          deletedHttpRequestMetrics += db.prepare("DELETE FROM http_request_metric_events WHERE created_at < ?").run(cutoff).changes;
        }
        if (normalizedMaxToolMetricRows) {
          const remainingToolMetrics = db.prepare("SELECT count(*) AS count FROM tool_metric_events").get().count;
          const overflow = Math.max(0, remainingToolMetrics - normalizedMaxToolMetricRows);
          if (overflow > 0) {
            deletedToolMetrics += db.prepare(`
              DELETE FROM tool_metric_events
              WHERE metric_id IN (
                SELECT metric_id FROM tool_metric_events ORDER BY created_at ASC LIMIT ?
              )
            `).run(overflow).changes;
          }
        }
        if (normalizedMaxHttpRequestMetricRows) {
          const remainingHttpMetrics = db.prepare("SELECT count(*) AS count FROM http_request_metric_events").get().count;
          const overflow = Math.max(0, remainingHttpMetrics - normalizedMaxHttpRequestMetricRows);
          if (overflow > 0) {
            deletedHttpRequestMetrics += db.prepare(`
              DELETE FROM http_request_metric_events
              WHERE metric_id IN (
                SELECT metric_id FROM http_request_metric_events ORDER BY created_at ASC LIMIT ?
              )
            `).run(overflow).changes;
          }
        }
      });
      run();
    }
    const after = dryRun
      ? before
      : {
          toolMetrics: db.prepare("SELECT count(*) AS count FROM tool_metric_events").get().count,
          httpRequestMetrics: db.prepare("SELECT count(*) AS count FROM http_request_metric_events").get().count
        };

    return {
      schemaVersion: "pact.tool-management.metrics-prune.v1",
      dryRun: Boolean(dryRun),
      cutoff,
      retentionDays: normalizeRetentionDays(retentionDays),
      maxToolMetricRows: normalizedMaxToolMetricRows,
      maxHttpRequestMetricRows: normalizedMaxHttpRequestMetricRows,
      planned,
      deleted: {
        toolMetrics: dryRun ? 0 : deletedToolMetrics,
        httpRequestMetrics: dryRun ? 0 : deletedHttpRequestMetrics
      },
      before,
      after
    };
  }

  function createMcpAuthorizationRequest(input = {}) {
    const requestId = randomId("mcp_auth_req");
    const sourceIp = sourceIpFromRequest(input.request);

    db.prepare(`
      INSERT INTO mcp_authorization_requests (
        request_id, client_name, requested_scopes_json, requested_tools_json,
        reason, status, source_ip, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      requestId,
      String(input.clientName || ""),
      stringifyJson(input.requestedScopes || []),
      stringifyJson(input.requestedTools || []),
      String(input.reason || ""),
      "pending",
      sourceIp,
      nowIso()
    );

    return { requestId, status: "pending" };
  }

  function listMcpAuthorizationRequests({ status = "pending" } = {}) {
    const rows = db.prepare("SELECT * FROM mcp_authorization_requests WHERE status = ? ORDER BY created_at DESC").all(status);
    return rows.map(row => ({
      requestId: row.request_id,
      clientName: row.client_name,
      requestedScopes: parseJson(row.requested_scopes_json, []),
      requestedTools: parseJson(row.requested_tools_json, []),
      reason: row.reason,
      status: row.status,
      sourceIp: row.source_ip,
      grantId: row.grant_id,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at
    }));
  }

  function resolveMcpAuthorizationRequest({ requestId, resolution, grantId = "" }) {
    if (!["approved", "rejected"].includes(resolution)) {
      throw new Error("Invalid resolution status");
    }

    const info = db.prepare(`
      UPDATE mcp_authorization_requests
      SET status = ?, resolved_at = ?, grant_id = ?
      WHERE request_id = ? AND status = 'pending'
    `).run(resolution, nowIso(), String(grantId), String(requestId));

    return info.changes > 0;
  }

  return {
    db,
    rootPath,
    listGrants,
    getGrant: (grantId) => publicGrant(getGrant(grantId)),
    getRawGrant: getGrant,
    createGrant,
    updateGrant,
    deleteGrant,
    revokeGrant,
    rotateGrantToken,
    authorizeRequest,
    appendGrantEvent,
    appendPolicyDecision,
    appendExecution,
    appendMetric,
    appendHttpRequestMetric,
    saveCatalogSnapshot,
    listAudit,
    getAudit,
    metricsSummary,
    metricsExport,
    metricsHealth,
    metricsPrometheus,
    metricsStorageSummary,
    pruneMetrics,
    createMcpAuthorizationRequest,
    listMcpAuthorizationRequests,
    resolveMcpAuthorizationRequest,
    capabilityKeyProvider: resolvedCapabilityKeyProvider,
    capabilityBindingGuard: resolvedCapabilityBindingGuard,
    close() {
      try {
        db.pragma("wal_checkpoint(TRUNCATE)");
      } catch {
        // Closing must remain best-effort; verification cleanup should not depend on WAL support.
      }
      db.close();
      resolvedCapabilityKeyProvider?.close?.();
      resolvedCapabilityBindingGuard?.close?.();
    }
  };
}
