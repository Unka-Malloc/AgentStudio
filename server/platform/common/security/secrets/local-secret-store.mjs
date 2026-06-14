import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ServerConfig } from "../../config/ServerConfig.mjs";

export const LOCAL_SECRET_STORE_VERSION = "v0.0.1:risk-control:local-secret-store-1";

const SECRET_STORE_DIR = "secrets";
const REGISTRY_FILE = "registry.json";
const AUDIT_FILE = "audit.jsonl";
const VALUES_DIR = "values";
const CONFIG_REFS_FILE = path.join("config", "refs.json");
const SERVICEHUB_SECRET_INVALIDATION_SCOPES = Object.freeze([
  "tool-management-catalog",
  "mcp-tools-list",
  "grant-projection",
  "external-service-runtime-cache",
  "external-service-health-state",
  "upstream-session"
]);

const CODESPACE_CAPABILITIES = Object.freeze([
  "repository.status",
  "tree.list",
  "file.read",
  "diff.read",
  "change.prepare",
  "change.upload",
  "review.comment",
  "review.requestChanges",
  "review.approve",
  "review.status.sync"
]);

const KNOWLEDGE_CAPABILITIES = Object.freeze([
  "backend.connect",
  "space.list",
  "search",
  "evidence.get",
  "export.request",
  "permission.request"
]);

export const LOCAL_SECRET_TARGETS = Object.freeze({
  github: {
    provider: "github",
    aliases: ["github", "gh"],
    family: "codespace",
    configProvider: "github",
    secretRef: "secret://pact/codespace/github-app",
    endpointRef: "config://pact/codespace/github-endpoint",
    authType: "githubApp",
    defaultMode: "contract",
    envSecrets: [
      { name: "PACT_GITHUB_TOKEN", key: "token" },
      { name: "GITHUB_TOKEN", key: "token" }
    ]
  },
  gerrit: {
    provider: "gerrit",
    aliases: ["gerrit"],
    family: "codespace",
    configProvider: "gerrit",
    secretRef: "secret://pact/codespace/gerrit-service-account",
    endpointRef: "config://pact/codespace/gerrit-endpoint",
    authType: "serviceAccount",
    defaultMode: "contract",
    envSecrets: [
      { name: "PACT_GERRIT_HTTP_PASSWORD", key: "httpPassword" },
      { name: "PACT_GERRIT_PASSWORD", key: "httpPassword" },
      { name: "PACT_GERRIT_TOKEN", key: "token" },
      { name: "PACT_GERRIT_BEARER_TOKEN", key: "token" }
    ]
  },
  dify: {
    provider: "dify",
    aliases: ["dify"],
    family: "knowledge",
    configProvider: "dify",
    secretRef: "secret://pact/knowledge/dify-api-key",
    endpointRef: "config://pact/knowledge/dify-endpoint",
    authType: "apiKey",
    defaultMode: "contract",
    envSecrets: [
      { name: "PACT_DIFY_API_KEY", key: "apiKey" },
      { name: "DIFY_API_KEY", key: "apiKey" }
    ]
  },
  ragflow: {
    provider: "ragflow",
    aliases: ["ragflow", "rag-flow"],
    family: "knowledge",
    configProvider: "ragflow",
    secretRef: "secret://pact/knowledge/ragflow-api-key",
    endpointRef: "config://pact/knowledge/ragflow-endpoint",
    authType: "apiKey",
    defaultMode: "contract",
    envSecrets: [
      { name: "PACT_RAGFLOW_API_KEY", key: "apiKey" },
      { name: "RAGFLOW_API_KEY", key: "apiKey" }
    ]
  },
  servicehub: {
    provider: "servicehub",
    aliases: ["servicehub", "service-hub", "external-service", "external-services"],
    family: "servicehub",
    configProvider: "servicehub",
    secretRef: "secret://servicehub/default/api-key",
    endpointRef: "config://servicehub/default-endpoint",
    authType: "bearer",
    defaultMode: "contract",
    envSecrets: [
      { name: "PACT_SERVICEHUB_TOKEN", key: "token" },
      { name: "PACT_SERVICEHUB_API_KEY", key: "apiKey" }
    ]
  },
  onedrive: {
    provider: "onedrive",
    aliases: ["onedrive", "one-drive", "one_drive"],
    family: "cloud-drive",
    configProvider: "onedrive",
    secretRef: "secret://pact/drive/onedrive-oauth",
    endpointRef: "config://pact/drive/onedrive-endpoint",
    authType: "oauth2",
    oauthRedirect: true,
    defaultMode: "contract",
    envSecrets: [{ name: "PACT_ONEDRIVE_OAUTH_JSON", key: "oauth" }]
  },
  "google-drive": {
    provider: "google-drive",
    aliases: ["google-drive", "gdrive", "google"],
    family: "cloud-drive",
    configProvider: "google-drive",
    secretRef: "secret://pact/drive/google-drive-oauth",
    endpointRef: "config://pact/drive/google-drive-endpoint",
    authType: "oauth2",
    oauthRedirect: true,
    defaultMode: "contract",
    envSecrets: [{ name: "PACT_GOOGLE_DRIVE_OAUTH_JSON", key: "oauth" }]
  },
  dropbox: {
    provider: "dropbox",
    aliases: ["dropbox"],
    family: "cloud-drive",
    configProvider: "dropbox",
    secretRef: "secret://pact/drive/dropbox-oauth",
    endpointRef: "config://pact/drive/dropbox-endpoint",
    authType: "oauth2",
    oauthRedirect: true,
    defaultMode: "contract",
    envSecrets: [{ name: "PACT_DROPBOX_OAUTH_JSON", key: "oauth" }]
  }
});

const PROVIDER_BY_ALIAS = new Map(
  Object.values(LOCAL_SECRET_TARGETS).flatMap((target) =>
    target.aliases.map((alias) => [alias, target.provider])
  )
);

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function stableJson(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function stableId(prefix, value, length = 24) {
  return `${prefix}_${sha256(stableJson(value)).slice(0, length)}`;
}

function resolveDataDir(dataDir = "") {
  return path.resolve(text(dataDir) || ServerConfig.getDataDir());
}

function storeRoot(dataDir = "") {
  return path.join(resolveDataDir(dataDir), SECRET_STORE_DIR);
}

export function localSecretStorePaths({ dataDir = "", secretRef = "" } = {}) {
  const root = storeRoot(dataDir);
  const valueId = secretRef ? sha256(secretRef).slice(0, 40) : "";
  return {
    dataDir: resolveDataDir(dataDir),
    root,
    registryPath: path.join(root, REGISTRY_FILE),
    auditPath: path.join(root, AUDIT_FILE),
    valuesDir: path.join(root, VALUES_DIR),
    valuePath: valueId ? path.join(root, VALUES_DIR, `${valueId}.json`) : "",
    configRefsPath: path.join(resolveDataDir(dataDir), CONFIG_REFS_FILE)
  };
}

async function ensurePrivateDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700).catch(() => {});
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return clone(fallback);
    throw error;
  }
}

async function writePrivateJson(filePath, value) {
  await ensurePrivateDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(filePath, 0o600).catch(() => {});
}

async function writeRuntimeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function appendAudit(dataDir, event) {
  const paths = localSecretStorePaths({ dataDir });
  await ensurePrivateDir(paths.root);
  await fs.appendFile(paths.auditPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(paths.auditPath, 0o600).catch(() => {});
}

function emptyRegistry() {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: LOCAL_SECRET_STORE_VERSION,
    updatedAt: nowIso(),
    refs: {}
  };
}

export function normalizeLocalSecretProvider(provider = "") {
  const normalized = text(provider).toLowerCase().replace(/_/g, "-");
  return PROVIDER_BY_ALIAS.get(normalized) || normalized;
}

export function resolveLocalSecretTarget(provider = "") {
  const targetId = normalizeLocalSecretProvider(provider);
  return LOCAL_SECRET_TARGETS[targetId] || null;
}

export function defaultSecretRefForProvider(provider = "") {
  return resolveLocalSecretTarget(provider)?.secretRef || "";
}

export function defaultEndpointRefForProvider(provider = "") {
  return resolveLocalSecretTarget(provider)?.endpointRef || "";
}

function assertSecretRef(secretRef = "") {
  const value = text(secretRef);
  if (!value.startsWith("secret://")) {
    throw new Error("Pact secret init requires a secret:// secretRef.");
  }
  return value;
}

function redactedValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "object") return "[redacted-object]";
  const raw = String(value);
  return raw.length <= 4 ? "****" : `***${raw.slice(-4)}`;
}

function redactedPayload(payload = {}) {
  const output = {};
  for (const [key, value] of Object.entries(asObject(payload))) {
    output[key] = redactedValue(value);
  }
  return output;
}

function revisionOf(entry = null) {
  const revision = Number(entry?.revision || 0);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 0;
}

function hasExpectedRevision(expectedRevision) {
  return expectedRevision !== undefined && expectedRevision !== null && text(expectedRevision) !== "";
}

function parseExpectedRevision(expectedRevision, secretRef) {
  const revision = Number(expectedRevision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    const error = new Error(`Pact local secret expectedRevision is invalid for ${secretRef}.`);
    error.code = "local_secret_revision_invalid";
    error.secretRef = secretRef;
    error.expectedRevision = expectedRevision;
    throw error;
  }
  return revision;
}

function assertExpectedRevision(entry, expectedRevision, secretRef) {
  if (!hasExpectedRevision(expectedRevision)) return;
  const expected = parseExpectedRevision(expectedRevision, secretRef);
  const actual = revisionOf(entry);
  if (actual !== expected) {
    const error = new Error(`Pact local secret revision conflict for ${secretRef}: expected ${expected}, got ${actual}.`);
    error.code = "local_secret_revision_conflict";
    error.secretRef = secretRef;
    error.expectedRevision = expected;
    error.actualRevision = actual;
    throw error;
  }
}

function cleanTextList(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((item) => text(item)).filter(Boolean))];
}

function publicScopeMetadata(scope = {}) {
  const input = asObject(scope, null);
  if (!input) return text(scope) ? text(scope) : null;
  const output = {};
  for (const key of ["serviceId", "serviceName", "tenantId", "workspaceId", "authBindingId", "bindingId", "dataClass", "sensitivity"]) {
    const value = text(input[key]);
    if (value) output[key] = value;
  }
  for (const key of ["scopes", "allowedScopes", "allowedHosts", "allowedProtocols"]) {
    const values = cleanTextList(input[key]);
    if (values.length > 0) output[key] = values;
  }
  return Object.keys(output).length > 0 ? output : null;
}

function publicSecretMetadata(metadata = {}, existing = {}) {
  const input = asObject(metadata);
  const output = { ...asObject(existing) };
  for (const key of ["serviceId", "serviceName", "tenantId", "workspaceId", "authBindingId", "bindingId", "dataClass", "sensitivity", "label"]) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = text(input[key]);
    if (value) output[key] = value;
    else delete output[key];
  }
  for (const key of ["scopes", "allowedScopes", "allowedHosts", "allowedProtocols"]) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const values = cleanTextList(input[key]);
    if (values.length > 0) output[key] = values;
    else delete output[key];
  }
  if (Object.prototype.hasOwnProperty.call(input, "scope")) {
    const scope = publicScopeMetadata(input.scope);
    if (scope) output.scope = scope;
    else delete output.scope;
  }
  return output;
}

function lifecycleStatus(entry = {}) {
  if (entry?.revokedAt) return "revoked";
  return text(entry?.status || "active").toLowerCase();
}

function entryResolvable(entry = null) {
  return entry?.credentialConfigured === true && lifecycleStatus(entry) === "active";
}

function serviceIdFromSecretMetadata(metadata = {}) {
  const source = asObject(metadata);
  return text(source.serviceId || source.scope?.serviceId);
}

function effectiveSecretScope(metadata = {}) {
  const source = asObject(metadata);
  return {
    ...source,
    ...asObject(source.scope)
  };
}

function normalizedHost(value = "") {
  return text(value).toLowerCase().replace(/^\[|\]$/g, "");
}

function protocolName(value = "") {
  return text(value).toLowerCase().replace(/:$/, "");
}

function assertScopeTextMatch({
  scope = {},
  expected = {},
  field = "",
  reasonCode = ""
} = {}) {
  const allowed = text(scope[field]);
  const requested = text(expected[field]);
  if (!allowed || !requested || allowed === requested) {
    return;
  }
  const error = new Error(`Pact local secret scope denied: ${reasonCode || field}.`);
  error.code = "local_secret_scope_denied";
  error.reasonCode = reasonCode || `${field}_mismatch`;
  error.field = field;
  throw error;
}

function assertScopeListIncludes({
  scope = {},
  expected = {},
  scopeField = "",
  expectedValue = "",
  normalize = text,
  reasonCode = ""
} = {}) {
  const allowed = cleanTextList(scope[scopeField]).map((item) => normalize(item)).filter(Boolean);
  const requested = normalize(expectedValue);
  if (allowed.length === 0 || !requested || allowed.includes(requested)) {
    return;
  }
  const error = new Error(`Pact local secret scope denied: ${reasonCode || scopeField}.`);
  error.code = "local_secret_scope_denied";
  error.reasonCode = reasonCode || `${scopeField}_not_allowed`;
  error.field = scopeField;
  throw error;
}

function assertSecretScopeAllowed({
  entry = {},
  secretRef = "",
  expectedScope = {}
} = {}) {
  const expected = asObject(expectedScope, null);
  if (!expected) {
    return;
  }
  const scope = effectiveSecretScope(entry.metadata);
  try {
    assertScopeTextMatch({ scope, expected, field: "serviceId", reasonCode: "service_id_mismatch" });
    assertScopeTextMatch({ scope, expected, field: "tenantId", reasonCode: "tenant_id_mismatch" });
    assertScopeTextMatch({ scope, expected, field: "workspaceId", reasonCode: "workspace_id_mismatch" });
    assertScopeTextMatch({ scope, expected, field: "authBindingId", reasonCode: "auth_binding_id_mismatch" });
    assertScopeListIncludes({
      scope,
      expected,
      scopeField: "allowedHosts",
      expectedValue: expected.host,
      normalize: normalizedHost,
      reasonCode: "host_not_allowed"
    });
    assertScopeListIncludes({
      scope,
      expected,
      scopeField: "allowedProtocols",
      expectedValue: expected.protocol,
      normalize: protocolName,
      reasonCode: "protocol_not_allowed"
    });
    for (const requestedScope of cleanTextList(expected.scopes || expected.requiredScopes)) {
      assertScopeListIncludes({
        scope,
        expected,
        scopeField: "scopes",
        expectedValue: requestedScope,
        reasonCode: "scope_not_allowed"
      });
    }
    for (const requestedScope of cleanTextList(expected.allowedScopes)) {
      assertScopeListIncludes({
        scope,
        expected,
        scopeField: "allowedScopes",
        expectedValue: requestedScope,
        reasonCode: "allowed_scope_not_allowed"
      });
    }
  } catch (error) {
    error.secretRef = secretRef;
    error.statusCode = 403;
    throw error;
  }
}

function serviceHubSecretCatalogChange({
  entry = {},
  secretRef = "",
  reasonCode = "",
  at = nowIso()
} = {}) {
  if (entry.provider !== "servicehub" && entry.family !== "servicehub") {
    return null;
  }
  const resolvedReason = text(reasonCode || "external_service_secret_changed") || "external_service_secret_changed";
  const serviceId = serviceIdFromSecretMetadata(entry.metadata);
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    source: "secret-store",
    type: resolvedReason,
    reasonCode: resolvedReason,
    serviceId,
    secretRefFingerprint: sha256(secretRef),
    at,
    invalidation: {
      reasonCode: resolvedReason,
      serviceId,
      scopes: [...SERVICEHUB_SECRET_INVALIDATION_SCOPES]
    }
  };
}

async function readRegistry(dataDir = "") {
  const paths = localSecretStorePaths({ dataDir });
  const registry = await readJson(paths.registryPath, emptyRegistry());
  return {
    ...emptyRegistry(),
    ...registry,
    refs: asObject(registry.refs)
  };
}

async function saveRegistry(dataDir, registry) {
  registry.updatedAt = nowIso();
  const paths = localSecretStorePaths({ dataDir });
  await writePrivateJson(paths.registryPath, registry);
}

function defaultCodespaceConfig() {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: "v0.0.1:platform:codespace-1",
    updatedAt: nowIso(),
    providers: {
      github: {
        provider: "github",
        enabled: true,
        mode: "contract",
        authType: "githubApp",
        secretRef: "secret://pact/codespace/github-app",
        repositoryPort: true,
        reviewPort: true,
        capabilities: [...CODESPACE_CAPABILITIES]
      },
      gerrit: {
        provider: "gerrit",
        enabled: true,
        mode: "contract",
        authType: "serviceAccount",
        secretRef: "secret://pact/codespace/gerrit-service-account",
        repositoryPort: true,
        reviewPort: true,
        capabilities: [...CODESPACE_CAPABILITIES]
      }
    }
  };
}

function defaultKnowledgeConfig() {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: "v0.0.1:knowledge:backend-port-1",
    updatedAt: nowIso(),
    providers: {
      dify: {
        provider: "dify",
        enabled: true,
        mode: "contract",
        authType: "apiKey",
        secretRef: "secret://pact/knowledge/dify-api-key",
        endpointRef: "config://pact/knowledge/dify-endpoint",
        datasetPort: true,
        retrievalPort: true,
        evidencePort: true,
        exportPort: true,
        capabilities: [...KNOWLEDGE_CAPABILITIES],
        contractSpaces: [
          {
            spaceRef: "dify-contract-handbook",
            label: "Dify Contract Handbook",
            description: "Contract metadata fixture for Dify knowledge retrieval.",
            dataClass: "internal",
            sensitivity: "normal"
          }
        ]
      },
      ragflow: {
        provider: "ragflow",
        enabled: true,
        mode: "contract",
        authType: "apiKey",
        secretRef: "secret://pact/knowledge/ragflow-api-key",
        endpointRef: "config://pact/knowledge/ragflow-endpoint",
        datasetPort: true,
        retrievalPort: true,
        evidencePort: true,
        exportPort: true,
        capabilities: [...KNOWLEDGE_CAPABILITIES],
        contractSpaces: [
          {
            spaceRef: "ragflow-contract-handbook",
            label: "RAGFlow Contract Handbook",
            description: "Contract metadata fixture for RAGFlow knowledge retrieval.",
            dataClass: "internal",
            sensitivity: "normal"
          }
        ]
      }
    }
  };
}

function defaultCloudDriveConfig() {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: "v0.0.1:storage:cloud-drive-port-1",
    updatedAt: nowIso(),
    connections: {}
  };
}

async function upsertConfigRef({ dataDir, endpointRef = "", endpoint = "", provider = "" } = {}) {
  if (!text(endpointRef) || !text(endpoint)) {
    return null;
  }
  const paths = localSecretStorePaths({ dataDir });
  const config = await readJson(paths.configRefsPath, {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: "v0.0.1:storage:runtime-config-refs-1",
    updatedAt: nowIso(),
    refs: {}
  });
  config.refs = asObject(config.refs);
  config.refs[endpointRef] = {
    ref: endpointRef,
    kind: "endpoint",
    provider,
    value: text(endpoint),
    updatedAt: nowIso()
  };
  config.updatedAt = nowIso();
  await writeRuntimeJson(paths.configRefsPath, config);
  return {
    ref: endpointRef,
    path: paths.configRefsPath
  };
}

async function updateCodespaceManifest({ dataDir, target, secretRef, endpointRef, endpoint, mode, authType }) {
  const filePath = path.join(resolveDataDir(dataDir), "code-management", "codespace-providers.json");
  const existing = await readJson(filePath, null);
  const config = {
    ...defaultCodespaceConfig(),
    ...asObject(existing),
    providers: {
      ...defaultCodespaceConfig().providers,
      ...asObject(existing?.providers)
    }
  };
  const providerId = target.configProvider;
  config.providers[providerId] = {
    ...asObject(config.providers[providerId]),
    provider: providerId,
    enabled: true,
    mode,
    authType,
    secretRef,
    endpointRef: endpointRef || config.providers[providerId]?.endpointRef || "",
    credentialConfigured: true,
    lastSecretInitializedAt: nowIso()
  };
  config.updatedAt = nowIso();
  await writeRuntimeJson(filePath, config);
  const configRef = await upsertConfigRef({ dataDir, endpointRef, endpoint, provider: providerId });
  return {
    kind: "codespace-provider-manifest",
    provider: providerId,
    path: filePath,
    endpointRef: configRef?.ref || endpointRef || ""
  };
}

async function updateKnowledgeManifest({ dataDir, target, secretRef, endpointRef, endpoint, mode, authType }) {
  const filePath = path.join(resolveDataDir(dataDir), "knowledge", "knowledge-backends.json");
  const existing = await readJson(filePath, null);
  const config = {
    ...defaultKnowledgeConfig(),
    ...asObject(existing),
    providers: {
      ...defaultKnowledgeConfig().providers,
      ...asObject(existing?.providers)
    }
  };
  const providerId = target.configProvider;
  config.providers[providerId] = {
    ...asObject(config.providers[providerId]),
    provider: providerId,
    enabled: true,
    mode,
    authType,
    secretRef,
    endpointRef: endpointRef || config.providers[providerId]?.endpointRef || "",
    credentialConfigured: true,
    lastSecretInitializedAt: nowIso()
  };
  config.updatedAt = nowIso();
  await writeRuntimeJson(filePath, config);
  const configRef = await upsertConfigRef({ dataDir, endpointRef, endpoint, provider: providerId });
  return {
    kind: "knowledge-backend-manifest",
    provider: providerId,
    path: filePath,
    endpointRef: configRef?.ref || endpointRef || ""
  };
}

async function updateCloudDriveManifest({ dataDir, target, secretRef, endpointRef, endpoint, mode, authType, metadata }) {
  const filePath = path.join(resolveDataDir(dataDir), "agent-workspaces", "cloud-drive-connections.json");
  const existing = await readJson(filePath, null);
  const config = {
    ...defaultCloudDriveConfig(),
    ...asObject(existing),
    connections: asObject(existing?.connections)
  };
  const providerId = target.configProvider;
  const workspaceId = text(metadata.workspaceId || "default") || "default";
  const driveRef = text(metadata.driveRef || metadata.driveId) || stableId("cloud_drive", {
    provider: providerId,
    secretRef,
    workspaceId
  });
  const timestamp = nowIso();
  config.connections[driveRef] = {
    ...asObject(config.connections[driveRef]),
    driveRef,
    provider: providerId,
    workspaceId,
    label: text(metadata.label || `${providerId} OAuth Adapter`),
    mode: "contract",
    requestedMode: mode,
    authType,
    secretRef,
    endpointRef: endpointRef || `config://pact/drive/${providerId}-endpoint`,
    rootName: `${providerId}-contract-root`,
    rootHash: sha256(`${providerId}:${secretRef}`),
    status: "active",
    credentialConfigured: true,
    contractVerified: true,
    localAdapterVerified: false,
    connectedAt: config.connections[driveRef]?.connectedAt || timestamp,
    updatedAt: timestamp
  };
  config.updatedAt = timestamp;
  await writeRuntimeJson(filePath, config);
  const configRef = await upsertConfigRef({ dataDir, endpointRef, endpoint, provider: providerId });
  return {
    kind: "cloud-drive-connections",
    provider: providerId,
    path: filePath,
    driveRef,
    endpointRef: configRef?.ref || endpointRef || ""
  };
}

async function updateProviderManifest(input) {
  if (input.target.family === "codespace") {
    return updateCodespaceManifest(input);
  }
  if (input.target.family === "knowledge") {
    return updateKnowledgeManifest(input);
  }
  if (input.target.family === "cloud-drive") {
    return updateCloudDriveManifest(input);
  }
  return null;
}

async function upsertLocalSecret({
  dataDir = "",
  provider = "",
  secretRef = "",
  endpointRef = "",
  endpoint = "",
  mode = "",
  authType = "",
  payload = {},
  metadata = {},
  updateManifest = true,
  expectedRevision,
  operation = "initialize"
} = {}) {
  const target = resolveLocalSecretTarget(provider);
  if (!target) {
    throw new Error(`Unsupported Pact secret provider: ${provider}`);
  }
  const resolvedSecretRef = assertSecretRef(secretRef || target.secretRef);
  const resolvedEndpointRef = text(endpointRef || target.endpointRef);
  const resolvedMode = text(mode || target.defaultMode || "contract") || "contract";
  const resolvedAuthType = text(authType || target.authType);
  const secretPayload = asObject(payload);
  if (Object.keys(secretPayload).length === 0) {
    throw new Error("Pact secret init requires a secret payload from --json-stdin, --token-stdin, --api-key-stdin, --http-password-stdin, --oauth-json-stdin, OAuth redirect flow, --body, --body-file, or --from-env.");
  }

  const paths = localSecretStorePaths({ dataDir, secretRef: resolvedSecretRef });
  await ensurePrivateDir(paths.root);
  await ensurePrivateDir(paths.valuesDir);

  const registry = await readRegistry(paths.dataDir);
  const existing = registry.refs[resolvedSecretRef] || null;
  if (operation === "rotate" && !existing) {
    const error = new Error(`Pact local secret is not configured: ${resolvedSecretRef}`);
    error.code = "local_secret_not_configured";
    error.secretRef = resolvedSecretRef;
    throw error;
  }
  assertExpectedRevision(existing, expectedRevision, resolvedSecretRef);
  const timestamp = nowIso();
  const previousRevision = revisionOf(existing);
  const revision = previousRevision + 1;
  const rotatedAt = existing || operation === "rotate" ? timestamp : "";
  const publicMetadata = publicSecretMetadata(metadata, existing?.metadata);
  const valueRecord = {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: LOCAL_SECRET_STORE_VERSION,
    secretRef: resolvedSecretRef,
    provider: target.provider,
    family: target.family,
    authType: resolvedAuthType,
    mode: resolvedMode,
    endpointRef: resolvedEndpointRef,
    payload: secretPayload,
    metadata: asObject(metadata),
    status: "active",
    revision,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    ...(rotatedAt ? { rotatedAt } : {})
  };
  await writePrivateJson(paths.valuePath, valueRecord);

  const entry = {
    secretRef: resolvedSecretRef,
    provider: target.provider,
    family: target.family,
    authType: resolvedAuthType,
    mode: resolvedMode,
    endpointRef: resolvedEndpointRef,
    storageRef: `local:${path.basename(paths.valuePath)}`,
    valueKeys: Object.keys(secretPayload).sort(),
    redacted: redactedPayload(secretPayload),
    credentialConfigured: true,
    status: "active",
    revision,
    createdAt: existing?.createdAt || valueRecord.createdAt,
    updatedAt: valueRecord.updatedAt,
    ...(rotatedAt ? { rotatedAt } : {}),
    ...(Object.keys(publicMetadata).length > 0 ? { metadata: publicMetadata } : {})
  };
  registry.refs[resolvedSecretRef] = entry;
  await saveRegistry(paths.dataDir, registry);

  const manifestUpdate = updateManifest
    ? await updateProviderManifest({
        dataDir: paths.dataDir,
        target,
        secretRef: resolvedSecretRef,
        endpointRef: resolvedEndpointRef,
        endpoint,
        mode: resolvedMode,
        authType: resolvedAuthType,
        metadata: asObject(metadata)
      })
    : null;

  const event = operation === "rotate" ? "secret.rotated" : existing ? "secret.updated" : "secret.initialized";
  const catalogChange = serviceHubSecretCatalogChange({
    entry,
    secretRef: resolvedSecretRef,
    reasonCode: operation === "rotate"
      ? "external_service_secret_rotated"
      : existing
        ? "external_service_secret_updated"
        : "external_service_secret_initialized",
    at: timestamp
  });
  await appendAudit(paths.dataDir, {
    event,
    secretRef: resolvedSecretRef,
    provider: target.provider,
    family: target.family,
    mode: resolvedMode,
    authType: resolvedAuthType,
    valueKeys: entry.valueKeys,
    previousRevision,
    revision,
    status: "active",
    ...(rotatedAt ? { rotatedAt } : {}),
    manifestUpdated: Boolean(manifestUpdate),
    createdAt: timestamp
  });

  return {
    ok: true,
    protocolVersion: LOCAL_SECRET_STORE_VERSION,
    provider: target.provider,
    family: target.family,
    dataDir: paths.dataDir,
    secretRef: resolvedSecretRef,
    endpointRef: resolvedEndpointRef,
    mode: resolvedMode,
    authType: resolvedAuthType,
    credentialConfigured: true,
    status: "active",
    revision,
    ...(rotatedAt ? { rotatedAt } : {}),
    valueStored: true,
    registryPath: paths.registryPath,
    auditPath: paths.auditPath,
    valuePath: paths.valuePath,
    manifestUpdate,
    ...(catalogChange ? { catalogChange } : {}),
    entry
  };
}

export async function initializeLocalSecret(input = {}) {
  return upsertLocalSecret({ ...input, operation: "initialize" });
}

export async function rotateLocalSecret(input = {}) {
  return upsertLocalSecret({ ...input, operation: "rotate" });
}

function localValuePathForEntry(paths, entry = {}) {
  const storageRef = text(entry.storageRef);
  if (!storageRef.startsWith("local:")) return "";
  const fileName = storageRef.slice("local:".length);
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || path.basename(fileName) !== fileName) {
    return "";
  }
  return path.join(paths.valuesDir, fileName);
}

export async function revokeLocalSecret({
  dataDir = "",
  provider = "",
  secretRef = "",
  expectedRevision,
  reason = "",
  metadata = {}
} = {}) {
  const target = provider ? resolveLocalSecretTarget(provider) : null;
  if (provider && !target) {
    throw new Error(`Unsupported Pact secret provider: ${provider}`);
  }
  const resolvedSecretRef = assertSecretRef(secretRef || target?.secretRef || "");
  const paths = localSecretStorePaths({ dataDir, secretRef: resolvedSecretRef });
  const registry = await readRegistry(paths.dataDir);
  const existing = registry.refs[resolvedSecretRef] || null;
  if (!existing) {
    const error = new Error(`Pact local secret is not configured: ${resolvedSecretRef}`);
    error.code = "local_secret_not_configured";
    error.secretRef = resolvedSecretRef;
    throw error;
  }
  assertExpectedRevision(existing, expectedRevision, resolvedSecretRef);

  const timestamp = nowIso();
  const previousRevision = revisionOf(existing);
  const revision = previousRevision + 1;
  const publicMetadata = publicSecretMetadata(metadata, existing.metadata);
  const entry = {
    ...existing,
    secretRef: resolvedSecretRef,
    provider: existing.provider || target?.provider || "",
    family: existing.family || target?.family || "",
    credentialConfigured: false,
    status: "revoked",
    revision,
    revokedAt: timestamp,
    updatedAt: timestamp,
    ...(Object.keys(publicMetadata).length > 0 ? { metadata: publicMetadata } : {})
  };
  registry.refs[resolvedSecretRef] = entry;
  await saveRegistry(paths.dataDir, registry);

  const valuePath = localValuePathForEntry(paths, existing);
  if (valuePath) {
    await fs.unlink(valuePath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }

  await appendAudit(paths.dataDir, {
    event: "secret.revoked",
    secretRef: resolvedSecretRef,
    provider: entry.provider,
    family: entry.family,
    previousRevision,
    revision,
    status: "revoked",
    revokedAt: timestamp,
    reason: text(reason),
    createdAt: timestamp
  });
  const catalogChange = serviceHubSecretCatalogChange({
    entry,
    secretRef: resolvedSecretRef,
    reasonCode: "external_service_secret_revoked",
    at: timestamp
  });

  return {
    ok: true,
    protocolVersion: LOCAL_SECRET_STORE_VERSION,
    provider: entry.provider,
    family: entry.family,
    dataDir: paths.dataDir,
    secretRef: resolvedSecretRef,
    credentialConfigured: false,
    status: "revoked",
    revision,
    revokedAt: timestamp,
    registryPath: paths.registryPath,
    auditPath: paths.auditPath,
    valuePath,
    ...(catalogChange ? { catalogChange } : {}),
    entry
  };
}

export async function readLocalSecretRegistry({ dataDir = "" } = {}) {
  return readRegistry(resolveDataDir(dataDir));
}

export async function resolveLocalSecretPayload({ dataDir = "", secretRef = "", expectedScope = null } = {}) {
  const resolvedSecretRef = assertSecretRef(secretRef);
  const paths = localSecretStorePaths({ dataDir, secretRef: resolvedSecretRef });
  const registry = await readRegistry(paths.dataDir);
  const entry = registry.refs[resolvedSecretRef] || null;
  if (!entry) {
    const error = new Error(`Pact local secret is not configured: ${resolvedSecretRef}`);
    error.code = "local_secret_not_configured";
    error.secretRef = resolvedSecretRef;
    throw error;
  }
  if (!entryResolvable(entry)) {
    const status = lifecycleStatus(entry);
    const error = new Error(`Pact local secret is not active: ${resolvedSecretRef}`);
    error.code = status === "revoked" ? "local_secret_revoked" : "local_secret_not_configured";
    error.secretRef = resolvedSecretRef;
    error.status = status;
    throw error;
  }
  assertSecretScopeAllowed({ entry, secretRef: resolvedSecretRef, expectedScope });
  const storageRef = text(entry.storageRef);
  if (!storageRef.startsWith("local:")) {
    const error = new Error(`Pact local secret storage is not local for ${resolvedSecretRef}.`);
    error.code = "local_secret_storage_unsupported";
    error.secretRef = resolvedSecretRef;
    throw error;
  }
  const fileName = storageRef.slice("local:".length);
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || path.basename(fileName) !== fileName) {
    const error = new Error(`Pact local secret storage ref is invalid for ${resolvedSecretRef}.`);
    error.code = "local_secret_storage_invalid";
    error.secretRef = resolvedSecretRef;
    throw error;
  }
  const valueRecord = await readJson(path.join(paths.valuesDir, fileName), null);
  if (valueRecord?.secretRef !== resolvedSecretRef) {
    const error = new Error(`Pact local secret value record does not match ${resolvedSecretRef}.`);
    error.code = "local_secret_value_mismatch";
    error.secretRef = resolvedSecretRef;
    throw error;
  }
  return {
    secretRef: resolvedSecretRef,
    provider: entry.provider || valueRecord.provider || "",
    family: entry.family || valueRecord.family || "",
    authType: entry.authType || valueRecord.authType || "",
    status: lifecycleStatus(entry),
    revision: revisionOf(entry),
    metadata: asObject(entry.metadata),
    payload: asObject(valueRecord.payload)
  };
}

export async function listLocalSecretEntries({ dataDir = "" } = {}) {
  const paths = localSecretStorePaths({ dataDir });
  const registry = await readRegistry(paths.dataDir);
  return Object.values(registry.refs).sort((left, right) =>
    String(left.provider || left.secretRef).localeCompare(String(right.provider || right.secretRef))
  );
}

export async function localSecretConfigured({ dataDir = "", provider = "", secretRef = "" } = {}) {
  const paths = localSecretStorePaths({ dataDir });
  const registry = await readRegistry(paths.dataDir);
  const refs = Object.values(registry.refs);
  const normalizedProvider = normalizeLocalSecretProvider(provider);
  return refs.some((entry) =>
    entryResolvable(entry) &&
    (!secretRef || entry.secretRef === secretRef) &&
    (!normalizedProvider || entry.provider === normalizedProvider)
  );
}
