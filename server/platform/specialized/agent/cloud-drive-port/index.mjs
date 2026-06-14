import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { ServerConfig } from "../../../common/config/ServerConfig.mjs";

export const CLOUD_DRIVE_PORT_PROTOCOL_VERSION = "v0.0.1:storage:cloud-drive-port-1";

const CLOUD_DRIVE_CONFIG_FILE = path.join("agent-workspaces", "cloud-drive-connections.json");
const CLOUD_DRIVE_LEDGER_FILE = path.join("agent-workspaces", "cloud-drive-ledger.json");
const DEFAULT_MANAGED_FOLDER_ROOT = ".pact-data";
const DEFAULT_MANAGED_CLIENT = "owner";
const DEFAULT_PUBLIC_FOLDER = "public";
const SUPPORTED_PROVIDERS = Object.freeze(["icloud", "onedrive", "google-drive", "dropbox"]);
const LOCAL_PROJECTION_PROVIDERS = new Set(["icloud", "onedrive"]);
const OAUTH_PROVIDERS = new Set(["onedrive", "google-drive", "dropbox"]);
const REMOTE_LIVE_MODES = new Set(["remote-live", "live", "remote", "sandbox-live"]);
const REMOTE_PROVIDER_PATHS = Object.freeze({
  connect: "/connect",
  list: "/items/list",
  download: "/files/download",
  upload: "/files/upload"
});
const MAX_REMOTE_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;
const SECRET_REF_BY_PROVIDER = Object.freeze({
  onedrive: "secret://pact/drive/onedrive-oauth",
  "google-drive": "secret://pact/drive/google-drive-oauth",
  dropbox: "secret://pact/drive/dropbox-oauth"
});
const SECRET_VALUE_KEYS = new Set([
  "apiKey",
  "api_key",
  "token",
  "accessToken",
  "refreshToken",
  "clientSecret",
  "client_secret",
  "password",
  "authorization"
]);

async function readResponseTextWithLimit(response, maxBytes = MAX_REMOTE_PROVIDER_RESPONSE_BYTES) {
  if (!response?.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error(`Remote cloud drive provider response exceeded the ${maxBytes} byte limit.`);
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`Remote cloud drive provider response exceeded the ${maxBytes} byte limit.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
const SECRET_URL_KEYS = /(?:access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password|authorization|signature|sig|secret)/i;

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function stableJson(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function digest(value, length = 24) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function stableId(prefix, value) {
  return `${prefix}::${digest(stableJson(value), 24)}`;
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function dataRoot(userDataPath = "") {
  return userDataPath || ServerConfig.getDataDir();
}

export function cloudDriveConfigPath(userDataPath = "") {
  return path.join(dataRoot(userDataPath), CLOUD_DRIVE_CONFIG_FILE);
}

function cloudDriveLedgerPath(userDataPath = "") {
  return path.join(dataRoot(userDataPath), CLOUD_DRIVE_LEDGER_FILE);
}

function defaultICloudRootPath() {
  return path.join(os.homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs");
}

function defaultOneDriveRootPath() {
  const cloudStorageRoot = path.join(os.homedir(), "Library", "CloudStorage");
  try {
    const candidates = fsSync.readdirSync(cloudStorageRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^OneDrive(?:[-\s]|$)/iu.test(entry.name))
      .map((entry) => path.join(cloudStorageRoot, entry.name))
      .sort((left, right) => left.length - right.length || left.localeCompare(right));
    if (candidates.length) return candidates[0];
  } catch {
    // OneDrive local folders are platform and user dependent.
  }
  try {
    const candidates = fsSync.readdirSync(os.homedir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^OneDrive(?:[-\s]|$)/iu.test(entry.name))
      .map((entry) => path.join(os.homedir(), entry.name))
      .sort((left, right) => left.length - right.length || left.localeCompare(right));
    if (candidates.length) return candidates[0];
  } catch {
    // Older OneDrive installs may not exist or may be unreadable.
  }
  return path.join(cloudStorageRoot, "OneDrive");
}

function defaultLocalProjectionRootPath(provider) {
  return provider === "onedrive" ? defaultOneDriveRootPath() : defaultICloudRootPath();
}

function defaultConfig() {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: CLOUD_DRIVE_PORT_PROTOCOL_VERSION,
    updatedAt: nowIso(),
    connections: {}
  };
}

function defaultLedger() {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: CLOUD_DRIVE_PORT_PROTOCOL_VERSION,
    updatedAt: nowIso(),
    events: [],
    transfers: {},
    checkpoints: {},
    accessReceipts: {}
  };
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return clone(fallback);
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeProvider(value = "") {
  const provider = text(value || "icloud").toLowerCase().replace(/_/g, "-");
  if (provider === "google" || provider === "gdrive" || provider === "google-drive") return "google-drive";
  if (provider === "one-drive" || provider === "one_drive" || provider === "onedrive") return "onedrive";
  if (provider === "icloud-drive" || provider === "icloud") return "icloud";
  return provider;
}

function providerLabel(provider) {
  return {
    icloud: "iCloud Drive",
    onedrive: "OneDrive",
    "google-drive": "Google Drive",
    dropbox: "Dropbox"
  }[provider] || provider;
}

function normalizeRemoteAdapterMode(value = "") {
  const raw = text(value || "contract").toLowerCase().replace(/[_\s]+/g, "-");
  return REMOTE_LIVE_MODES.has(raw) ? "remote-live" : "contract";
}

function normalizeLocalProjectionMode(value = "") {
  const raw = text(value || "").toLowerCase().replace(/[_\s]+/g, "-");
  if (["local", "local-live", "local-directory", "local-projection", "directory", "projection"].includes(raw)) {
    return "local";
  }
  return "";
}

function isLocalProjectionProvider(provider = "") {
  return LOCAL_PROJECTION_PROVIDERS.has(normalizeProvider(provider));
}

function wantsLocalProjection(provider = "", input = {}) {
  if (!isLocalProjectionProvider(provider)) return false;
  if (provider === "icloud") return true;
  const requestedMode = text(input.mode || input.requestedMode || input.adapterMode || "");
  if (normalizeLocalProjectionMode(requestedMode)) return true;
  if (REMOTE_LIVE_MODES.has(requestedMode.toLowerCase().replace(/[_\s]+/g, "-"))) return false;
  if (text(input.rootPath || input.sourcePath || input.localPath || input.path)) return true;
  return !requestedMode;
}

function isLocalProjectionConnection(connection = {}) {
  return connection.localAdapterVerified === true && Boolean(text(connection.rootPath));
}

function normalizeEndpointUrl(value = "") {
  const raw = text(value);
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    const error = new Error("Remote cloud drive endpointUrl must be a valid http(s) URL.");
    error.code = "REMOTE_ENDPOINT_INVALID";
    throw error;
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    const error = new Error("Remote cloud drive endpointUrl must use http or https.");
    error.code = "REMOTE_ENDPOINT_INVALID";
    throw error;
  }
  if (url.username || url.password || url.search) {
    const error = new Error("Remote cloud drive endpointUrl must not embed credentials or query secrets.");
    error.code = "REMOTE_ENDPOINT_SECRET_RISK";
    throw error;
  }
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function isRemoteLiveConnection(connection = {}) {
  return text(connection.mode) === "remote-live" && connection.remoteLiveVerified === true;
}

function connectionVerifiedState(connection = {}, fallback = "projected") {
  if (connection.contractVerified === true) return "contractVerified";
  if (isRemoteLiveConnection(connection)) return "remoteLiveVerified";
  if (connection.localAdapterVerified === true) return "localAdapterVerified";
  return fallback;
}

function sanitizeProviderWebUrl(value = "") {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_URL_KEYS.test(key)) {
        url.searchParams.set(key, "REDACTED");
      }
    }
    return url.toString();
  } catch {
    return raw.slice(0, 2048);
  }
}

function providerReceiptMetadata(value = {}) {
  const payload = asObject(value);
  const metadata = {
    fileId: text(payload.providerFileId || payload.fileId || payload.id || payload.itemId || ""),
    revision: text(payload.revision || payload.rev || payload.version || payload.providerRevision || ""),
    webUrl: sanitizeProviderWebUrl(payload.webUrl || payload.web_url || payload.url || payload.shareUrl || ""),
    etag: text(payload.etag || payload.eTag || payload.providerEtag || "")
  };
  return Object.values(metadata).some(Boolean) ? metadata : null;
}

function transferTelemetry({ operation = "", status = 0, requestBytes = 0, responseBytes = 0, durationMs = 0, endpointRef = "" } = {}) {
  const measuredDurationMs = Math.max(1, Math.round(Number(durationMs || 0)));
  const transferBytes = Math.max(0, Number(requestBytes || 0)) + Math.max(0, Number(responseBytes || 0));
  return {
    protocolVersion: "v0.0.1:storage:cloud-drive-transfer-telemetry-1",
    operation: text(operation),
    adapterMode: "remote-live",
    status: Number(status || 0),
    requestBytes: Math.max(0, Number(requestBytes || 0)),
    responseBytes: Math.max(0, Number(responseBytes || 0)),
    transferBytes,
    durationMs: measuredDurationMs,
    bytesPerSecond: Math.round((transferBytes * 1000) / measuredDurationMs),
    endpointRef: text(endpointRef)
  };
}

function remoteEndpointUrl(connection = {}, operation = "") {
  const route = REMOTE_PROVIDER_PATHS[operation];
  if (!route) {
    const error = new Error(`Unsupported remote cloud drive operation: ${operation}`);
    error.code = "REMOTE_OPERATION_UNSUPPORTED";
    throw error;
  }
  const baseUrl = normalizeEndpointUrl(connection.endpointUrl || connection.remoteEndpointUrl || "");
  if (!baseUrl) {
    const error = new Error("Remote cloud drive connection requires endpointUrl.");
    error.code = "REMOTE_ENDPOINT_REQUIRED";
    throw error;
  }
  return new URL(route.replace(/^\/+/, ""), `${baseUrl}/`).toString();
}

async function callRemoteProvider(connection = {}, operation = "", payload = {}) {
  const requestBody = JSON.stringify({
    protocolVersion: CLOUD_DRIVE_PORT_PROTOCOL_VERSION,
    operation,
    provider: normalizeProvider(connection.provider),
    driveRef: text(connection.driveRef),
    credentialRefHash: digest(connection.secretRef || "", 32),
    payload
  });
  const requestBytes = Buffer.byteLength(requestBody, "utf8");
  const startedAt = Date.now();
  let response;
  let responseText = "";
  try {
    response = await fetch(remoteEndpointUrl(connection, operation), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pact-Cloud-Drive-Protocol": CLOUD_DRIVE_PORT_PROTOCOL_VERSION,
        "X-Pact-Drive-Provider": normalizeProvider(connection.provider),
        "X-Pact-Secret-Ref-Hash": digest(connection.secretRef || "", 32)
      },
      body: requestBody
    });
    responseText = await readResponseTextWithLimit(response);
  } catch (error) {
    const wrapped = new Error(`Remote cloud drive provider is unavailable: ${error?.message || error}`);
    wrapped.code = "REMOTE_PROVIDER_UNAVAILABLE";
    throw wrapped;
  }
  const metrics = transferTelemetry({
    operation,
    status: response.status,
    requestBytes,
    responseBytes: Buffer.byteLength(responseText, "utf8"),
    durationMs: Date.now() - startedAt,
    endpointRef: connection.endpointRef
  });
  let parsed = {};
  if (responseText.trim()) {
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const error = new Error("Remote cloud drive provider returned invalid JSON.");
      error.code = "REMOTE_PROVIDER_INVALID_RESPONSE";
      error.telemetry = metrics;
      throw error;
    }
  }
  if (!response.ok || parsed.ok === false) {
    const error = new Error(text(parsed.error || parsed.message) || `Remote cloud drive provider failed with HTTP ${response.status}.`);
    error.code = text(parsed.code) || "REMOTE_PROVIDER_REQUEST_FAILED";
    error.telemetry = metrics;
    throw error;
  }
  return { payload: asObject(parsed), telemetry: metrics };
}

function assertSupportedProvider(provider) {
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    const error = new Error(`Unsupported cloud drive provider: ${provider}`);
    error.code = "UNSUPPORTED_PROVIDER";
    throw error;
  }
}

function containsSecretValue(value = {}, depth = 0) {
  if (!value || typeof value !== "object" || depth > 4) {
    return "";
  }
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_VALUE_KEYS.has(key) && text(child)) {
      return key;
    }
    if (child && typeof child === "object") {
      const nested = containsSecretValue(child, depth + 1);
      if (nested) return nested;
    }
  }
  return "";
}

function normalizeDriveRelativePath(value = "", { allowEmpty = true } = {}) {
  const raw = text(value).replace(/\\/g, "/");
  if (!raw || raw === ".") {
    if (allowEmpty) return "";
    throw new Error("云盘路径不能为空。");
  }
  if (raw.includes("\0") || raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) {
    throw new Error("云盘路径必须是 provider 内部相对路径。");
  }
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === ".") {
    if (allowEmpty) return "";
    throw new Error("云盘路径不能为空。");
  }
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("云盘路径不能跳出受控根目录。");
  }
  return normalized.replace(/^\/+/, "");
}

function normalizeManagedFolderSegment(value = "") {
  const raw = text(value)
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .trim();
  if (!raw || raw === "." || raw === ".." || raw.includes("/") || raw.includes("\0")) {
    return "";
  }
  return raw.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+$/, "") || "";
}

function normalizeManagedFolderRoot(value = "") {
  const root = normalizeDriveRelativePath(value || DEFAULT_MANAGED_FOLDER_ROOT, { allowEmpty: false });
  if (root === "." || root === ".." || root.startsWith("../")) {
    return DEFAULT_MANAGED_FOLDER_ROOT;
  }
  return root;
}

function normalizeMappingDrivePath(value = "", { allowRoot = true } = {}) {
  const raw = text(value).replace(/\\/g, "/");
  if ((raw === "" || raw === "." || raw === "/") && allowRoot) {
    return "";
  }
  return normalizeDriveRelativePath(raw, { allowEmpty: allowRoot });
}

function normalizeAllowedClients(value = []) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map((item) => item.trim());
  const clients = [...new Set(raw.map(normalizeManagedFolderSegment).filter(Boolean))];
  return clients.length ? clients : [DEFAULT_MANAGED_CLIENT];
}

function managedFolderPolicy(input = {}, provider = "icloud") {
  const enabled = input.managedFolder !== false && input.shareMode !== "directMapping";
  const rootPath = normalizeManagedFolderRoot(input.managedFolderRoot || input.pactDataRoot || DEFAULT_MANAGED_FOLDER_ROOT);
  const allowedClients = normalizeAllowedClients(input.allowedClients || input.allowedClientIds || input.clients || [DEFAULT_MANAGED_CLIENT]);
  const defaultClient = normalizeManagedFolderSegment(input.defaultClient || input.clientId || allowedClients[0]) || allowedClients[0];
  const publicFolder = normalizeManagedFolderSegment(input.publicFolder || DEFAULT_PUBLIC_FOLDER) || DEFAULT_PUBLIC_FOLDER;
  return {
    enabled,
    rootPath,
    ownerFolder: normalizeManagedFolderSegment(input.ownerFolder || DEFAULT_MANAGED_CLIENT) || DEFAULT_MANAGED_CLIENT,
    defaultClient: allowedClients.includes(defaultClient) ? defaultClient : allowedClients[0],
    publicFolder,
    allowedClients,
    accessModel: "agentDefaultAndPublic",
    userAction: "dragFilesIntoManagedFolderOrExposeReadOnlyDirectory",
    directMapping: false,
    provisioningState: provider === "icloud" ? "localAdapterVerified" : "contractVerified"
  };
}

function normalizeAccessMode(value = "") {
  const mode = text(value).toLowerCase().replace(/[_\s-]+/g, "");
  if (["allowlist", "whitelist", "allow", "only"].includes(mode)) return "allowlist";
  if (["denylist", "blacklist", "deny", "block"].includes(mode)) return "denylist";
  return "all";
}

function normalizeAccessPolicy(value = {}) {
  const policy = asObject(value);
  const mode = normalizeAccessMode(policy.mode || policy.permissionMode || policy.accessMode || (policy.defaultEveryone === false ? "allowlist" : "all"));
  const subjects = normalizeAllowedClients(
    policy.subjects ||
    policy.clients ||
    policy.allowedClients ||
    policy.deniedClients ||
    policy.allow ||
    policy.deny ||
    []
  );
  return {
    mode,
    defaultEveryone: mode === "all",
    subjects: mode === "all" ? [] : subjects
  };
}

function normalizeSpaceKind(value = "") {
  const kind = text(value).toLowerCase().replace(/[_\s-]+/g, "");
  if (["agentdefault", "default", "private", "clientdefault"].includes(kind)) return "agentDefault";
  if (["public", "shared", "common"].includes(kind)) return "public";
  return "advancedExposure";
}

function normalizeWritable(value, spaceKind = "advancedExposure") {
  if (spaceKind === "agentDefault") return true;
  if (value === true) return true;
  const raw = text(value).toLowerCase();
  return ["write", "writable", "readwrite", "rw"].includes(raw);
}

function materializedDefaultFolderPath(managed = {}, input = {}) {
  const rootPath = normalizeManagedFolderRoot(managed.rootPath || DEFAULT_MANAGED_FOLDER_ROOT);
  const allowedClients = normalizeAllowedClients(managed.allowedClients || [DEFAULT_MANAGED_CLIENT]);
  const requestedClient = normalizeManagedFolderSegment(input.clientId || input.client || input.subjectId || input.subject || managed.defaultClient || allowedClients[0]);
  const clientFolder = allowedClients.includes(requestedClient) ? requestedClient : normalizeManagedFolderSegment(managed.defaultClient || allowedClients[0]) || allowedClients[0];
  return normalizeDriveRelativePath(path.posix.join(rootPath, clientFolder), { allowEmpty: false });
}

function materializedPublicFolderPath(managed = {}) {
  const rootPath = normalizeManagedFolderRoot(managed.rootPath || DEFAULT_MANAGED_FOLDER_ROOT);
  const publicFolder = normalizeManagedFolderSegment(managed.publicFolder || DEFAULT_PUBLIC_FOLDER) || DEFAULT_PUBLIC_FOLDER;
  return normalizeDriveRelativePath(path.posix.join(rootPath, publicFolder), { allowEmpty: false });
}

function materializedMappingDrivePath(mapping = {}, managed = {}, input = {}) {
  if (mapping.spaceKind === "agentDefault") {
    return materializedDefaultFolderPath(managed, input);
  }
  if (mapping.spaceKind === "public") {
    return materializedPublicFolderPath(managed);
  }
  return normalizeMappingDrivePath(mapping.drivePath || "", { allowRoot: true });
}

function directoryMappingAliases(mapping = {}) {
  return [
    normalizeManagedFolderSegment(mapping.alias || ""),
    normalizeManagedFolderSegment(mapping.name || ""),
    normalizeManagedFolderSegment(mapping.mappingId || "")
  ].filter(Boolean);
}

function normalizeDirectoryMapping(value = {}, index = 0) {
  const mapping = asObject(value);
  const spaceKind = normalizeSpaceKind(mapping.spaceKind || mapping.kind || mapping.type || "");
  const rawDrivePath = mapping.drivePath ?? mapping.path ?? mapping.folderPath ?? (index === 0 ? DEFAULT_MANAGED_FOLDER_ROOT : "");
  const drivePath = normalizeMappingDrivePath(rawDrivePath, { allowRoot: true });
  const scope = drivePath ? "directory" : "wholeDrive";
  const fallbackName = scope === "wholeDrive" ? "Whole Drive" : (path.posix.basename(drivePath) || DEFAULT_MANAGED_FOLDER_ROOT);
  const name = text(mapping.name || mapping.label || fallbackName) || fallbackName;
  const accessPolicy = normalizeAccessPolicy(mapping.accessPolicy || mapping.permissionPolicy || {
    mode: mapping.permissionMode,
    subjects: mapping.subjects || mapping.clients || mapping.allowedClients || mapping.deniedClients,
    defaultEveryone: mapping.defaultEveryone
  });
  const mappingId = text(mapping.mappingId || mapping.id) || stableId("cloud_drive_mapping", {
    drivePath,
    index
  });
  return {
    mappingId,
    name,
    alias: normalizeManagedFolderSegment(mapping.alias || name) || `dir-${index + 1}`,
    drivePath,
    displayPath: text(mapping.displayPath || "") || (drivePath || "/"),
    scope,
    spaceKind,
    writable: normalizeWritable(mapping.writable ?? mapping.writeMode ?? mapping.accessMode, spaceKind),
    writePolicy: spaceKind === "agentDefault" ? "clientDefaultWritable" : "readOnlyByDefault",
    createIfMissing: mapping.createIfMissing === true,
    accessPolicy,
    metadataOnly: true
  };
}

function defaultDirectoryMappings(managed = {}) {
  const rootPath = normalizeManagedFolderRoot(managed.rootPath || DEFAULT_MANAGED_FOLDER_ROOT);
  const defaultClient = normalizeManagedFolderSegment(managed.defaultClient || DEFAULT_MANAGED_CLIENT) || DEFAULT_MANAGED_CLIENT;
  const publicFolderPath = materializedPublicFolderPath(managed);
  return [
    {
      mappingId: "managed-default-space",
      name: "默认空间",
      alias: "default",
      drivePath: path.posix.join(rootPath, defaultClient),
      displayPath: path.posix.join(rootPath, "{client}"),
      spaceKind: "agentDefault",
      writable: true,
      createIfMissing: true,
      accessPolicy: { mode: "all" }
    },
    {
      mappingId: "managed-public-space",
      name: "公共空间",
      alias: "public",
      drivePath: publicFolderPath,
      displayPath: publicFolderPath,
      spaceKind: "public",
      writable: false,
      createIfMissing: true,
      accessPolicy: { mode: "all" }
    }
  ];
}

function normalizeDirectoryMappings(value = [], managed = {}) {
  const rawMappings = Array.isArray(value) ? value : [];
  const mappings = [
    ...(managed.enabled === false ? [] : defaultDirectoryMappings(managed)),
    ...rawMappings.map((mapping) => ({
      ...asObject(mapping),
      spaceKind: asObject(mapping).spaceKind || asObject(mapping).kind || "advancedExposure",
      writable: asObject(mapping).writable === true,
      createIfMissing: asObject(mapping).createIfMissing === true
    }))
  ];
  const seen = new Set();
  const normalized = [];
  for (const [index, mapping] of mappings.entries()) {
    const next = normalizeDirectoryMapping(mapping, index);
    const key = `${next.spaceKind}:${next.alias}:${next.drivePath || "/"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(next);
  }
  return normalized.length ? normalized : [normalizeDirectoryMapping(defaultDirectoryMappings(managed)[0], 0)];
}

function publicDirectoryMappings(connection = {}) {
  return normalizeDirectoryMappings(connection.directoryMappings || [], connection.managedFolder)
    .map((mapping) => ({
      mappingId: mapping.mappingId,
      name: mapping.name,
      alias: mapping.alias,
      drivePath: mapping.displayPath,
      scope: mapping.scope,
      spaceKind: mapping.spaceKind,
      writable: mapping.writable === true,
      writePolicy: mapping.writePolicy,
      accessPolicy: mapping.accessPolicy,
      metadataOnly: true
    }));
}

function publicMapping(mapping = {}) {
  return {
    mappingId: mapping.mappingId,
    name: mapping.name,
    alias: mapping.alias,
    drivePath: mapping.displayPath,
    scope: mapping.scope,
    spaceKind: mapping.spaceKind,
    writable: mapping.writable === true,
    writePolicy: mapping.writePolicy,
    accessPolicy: mapping.accessPolicy
  };
}

async function provisionLocalDirectoryMappings(rootPath, mappings = [], managed = {}) {
  const provisioned = [];
  const managedRoot = managed.enabled === true ? normalizeManagedFolderRoot(managed.rootPath || DEFAULT_MANAGED_FOLDER_ROOT) : "";
  for (const mapping of normalizeDirectoryMappings(mappings, managed)) {
    if (mapping.spaceKind === "agentDefault") {
      await fs.mkdir(safeJoinLocal(rootPath, managedRoot, { allowRoot: false }).absolutePath, { recursive: true });
      for (const client of normalizeAllowedClients(managed.allowedClients)) {
        const folderPath = normalizeDriveRelativePath(path.posix.join(managedRoot, client), { allowEmpty: false });
        const clientTarget = safeJoinLocal(rootPath, folderPath, { allowRoot: false });
        await fs.mkdir(clientTarget.absolutePath, { recursive: true });
        provisioned.push({ mappingId: mapping.mappingId, drivePath: folderPath, state: "localAdapterVerified", writable: true });
      }
      continue;
    }
    if (mapping.spaceKind === "public") {
      const publicPath = materializedPublicFolderPath(managed);
      const publicTarget = safeJoinLocal(rootPath, publicPath, { allowRoot: false });
      await fs.mkdir(publicTarget.absolutePath, { recursive: true });
      provisioned.push({ mappingId: mapping.mappingId, drivePath: publicPath, state: "localAdapterVerified", writable: false });
      continue;
    }
    if (!mapping.drivePath) {
      provisioned.push({ mappingId: mapping.mappingId, drivePath: "/", state: "localAdapterVerified", writable: mapping.writable === true });
      continue;
    }
    const target = safeJoinLocal(rootPath, mapping.drivePath, { allowRoot: false });
    if (mapping.createIfMissing === true || mapping.drivePath === managedRoot) {
      await fs.mkdir(target.absolutePath, { recursive: true });
    } else {
      const stat = await fs.lstat(target.absolutePath);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`目录映射必须绑定已经存在的普通目录：${mapping.displayPath}`);
      }
    }
    provisioned.push({ mappingId: mapping.mappingId, drivePath: mapping.displayPath, state: "localAdapterVerified", writable: mapping.writable === true });
  }
  return provisioned;
}

function mappingContainsPath(mapping = {}, drivePath = "", managed = {}, input = {}) {
  const root = materializedMappingDrivePath(mapping, managed, input);
  const normalizedPath = normalizeMappingDrivePath(drivePath || "", { allowRoot: true });
  if (!root) return true;
  return normalizedPath === root || normalizedPath.startsWith(`${root}/`);
}

function subjectForInput(input = {}) {
  return normalizeManagedFolderSegment(input.clientId || input.client || input.subjectId || input.subject || "") || "";
}

function assertMappingAccess(mapping = {}, input = {}) {
  const subject = subjectForInput(input);
  const policy = normalizeAccessPolicy(mapping.accessPolicy);
  if (!subject || policy.mode === "all") {
    return;
  }
  const listed = policy.subjects.includes(subject);
  if ((policy.mode === "allowlist" && !listed) || (policy.mode === "denylist" && listed)) {
    const error = new Error("当前客户端无权访问该云盘目录映射。");
    error.code = "DRIVE_MAPPING_ACCESS_DENIED";
    throw error;
  }
}

function assertMappingWrite(connection = {}, resolved = {}, input = {}) {
  const mapping = asObject(resolved.mapping);
  const managed = asObject(connection.managedFolder);
  if (mapping.spaceKind === "agentDefault") {
    const defaultRoot = materializedDefaultFolderPath(managed, input);
    if (resolved.drivePath === defaultRoot || resolved.drivePath.startsWith(`${defaultRoot}/`)) {
      return;
    }
  }
  if (mapping.writable === true) {
    return;
  }
  const error = new Error("该云盘空间是只读映射；只能写入 default/ 默认空间。");
  error.code = "DRIVE_MAPPING_READ_ONLY";
  throw error;
}

function resolveMappedDrivePath(connection = {}, drivePath = "", { allowRoot = true, input = {} } = {}) {
  const raw = normalizeMappingDrivePath(drivePath, { allowRoot: true });
  const mappings = normalizeDirectoryMappings(connection.directoryMappings || [], connection.managedFolder);
  const managed = asObject(connection.managedFolder);
  if (!raw) {
    const mapping = mappings[0];
    assertMappingAccess(mapping, input);
    return {
      drivePath: normalizeMappingDrivePath(mapping.drivePath, { allowRoot }),
      mapping,
      requestedPath: raw
    };
  }
  for (const mapping of mappings) {
    for (const alias of directoryMappingAliases(mapping)) {
      if (raw === alias || raw.startsWith(`${alias}/`)) {
        const suffix = raw === alias ? "" : raw.slice(alias.length + 1);
        const mappingRoot = materializedMappingDrivePath(mapping, managed, input);
        const resolvedPath = normalizeMappingDrivePath(path.posix.join(mappingRoot || "", suffix), { allowRoot });
        assertMappingAccess(mapping, input);
        return { drivePath: resolvedPath, mapping, requestedPath: raw };
      }
    }
  }
  if (managed.enabled === true) {
    const rootPath = normalizeManagedFolderRoot(managed.rootPath || DEFAULT_MANAGED_FOLDER_ROOT);
    const allowedClients = normalizeAllowedClients(managed.allowedClients || [DEFAULT_MANAGED_CLIENT]);
    const publicPath = materializedPublicFolderPath(managed);
    if (raw === publicPath || raw.startsWith(`${publicPath}/`)) {
      const publicMapping = mappings.find((mapping) => mapping.spaceKind === "public");
      if (publicMapping) {
        assertMappingAccess(publicMapping, input);
        return { drivePath: normalizeMappingDrivePath(raw, { allowRoot }), mapping: publicMapping, requestedPath: raw };
      }
    }
    const [firstSegment] = raw.split("/");
    if (allowedClients.includes(firstSegment)) {
      const subject = subjectForInput(input);
      if (subject && subject !== firstSegment) {
        const error = new Error("当前客户端只能通过 default/ 访问自己的默认空间。");
        error.code = "DRIVE_MAPPING_ACCESS_DENIED";
        throw error;
      }
      const managedPath = normalizeDriveRelativePath(path.posix.join(rootPath, raw), { allowEmpty: false });
      const managedMapping = mappings.find((mapping) => mapping.spaceKind === "agentDefault" && mappingContainsPath(mapping, managedPath, managed, { ...input, clientId: firstSegment }));
      if (managedMapping) {
        assertMappingAccess(managedMapping, input);
        return { drivePath: managedPath, mapping: managedMapping, requestedPath: raw };
      }
    }
  }
  const matches = mappings
    .filter((mapping) => mappingContainsPath(mapping, raw, managed, input))
    .sort((left, right) => String(right.drivePath || "").length - String(left.drivePath || "").length);
  if (matches.length) {
    const mapping = matches[0];
    assertMappingAccess(mapping, input);
    return { drivePath: normalizeMappingDrivePath(raw, { allowRoot }), mapping, requestedPath: raw };
  }
  const error = new Error("云盘路径必须落在已配置的目录映射内。");
  error.code = "DRIVE_PATH_OUTSIDE_MAPPINGS";
  throw error;
}

function contractItemsForMappings(provider, connection, limit = 2, input = {}) {
  const items = [];
  for (const mapping of normalizeDirectoryMappings(connection.directoryMappings || [], connection.managedFolder)) {
    try {
      assertMappingAccess(mapping, input);
    } catch {
      continue;
    }
    const index = items.length;
    items.push(contractItem(provider, connection, index, mapping, input));
    if (items.length >= limit) break;
  }
  return items;
}

function managedFolderDrivePath(connection = {}, drivePath = "", { allowRoot = true, clientId = "" } = {}) {
  const managed = asObject(connection.managedFolder);
  const raw = normalizeDriveRelativePath(drivePath, { allowEmpty: true });
  if (managed.enabled !== true) {
    return normalizeDriveRelativePath(raw, { allowEmpty: allowRoot });
  }
  const rootPath = normalizeManagedFolderRoot(managed.rootPath || DEFAULT_MANAGED_FOLDER_ROOT);
  const allowedClients = normalizeAllowedClients(managed.allowedClients || [DEFAULT_MANAGED_CLIENT]);
  const defaultClient = normalizeManagedFolderSegment(clientId || managed.defaultClient || allowedClients[0]) || allowedClients[0];
  if (!raw) {
    return rootPath;
  }
  if (raw === rootPath || raw.startsWith(`${rootPath}/`)) {
    return normalizeDriveRelativePath(raw, { allowEmpty: allowRoot });
  }
  const [firstSegment] = raw.split("/");
  if (allowedClients.includes(firstSegment)) {
    return normalizeDriveRelativePath(path.posix.join(rootPath, raw), { allowEmpty: false });
  }
  return normalizeDriveRelativePath(path.posix.join(rootPath, defaultClient, raw), { allowEmpty: false });
}

function publicManagedFolder(connection = {}) {
  const managed = asObject(connection.managedFolder);
  if (managed.enabled !== true) {
    return {
      enabled: false,
      directMapping: true
    };
  }
  return {
    enabled: true,
    rootPath: normalizeManagedFolderRoot(managed.rootPath || DEFAULT_MANAGED_FOLDER_ROOT),
    ownerFolder: normalizeManagedFolderSegment(managed.ownerFolder || DEFAULT_MANAGED_CLIENT) || DEFAULT_MANAGED_CLIENT,
    defaultClient: normalizeManagedFolderSegment(managed.defaultClient || DEFAULT_MANAGED_CLIENT) || DEFAULT_MANAGED_CLIENT,
    publicFolder: normalizeManagedFolderSegment(managed.publicFolder || DEFAULT_PUBLIC_FOLDER) || DEFAULT_PUBLIC_FOLDER,
    allowedClients: normalizeAllowedClients(managed.allowedClients || [DEFAULT_MANAGED_CLIENT]),
    accessModel: "agentDefaultAndPublic",
    spaces: {
      default: {
        alias: "default",
        drivePath: `${normalizeManagedFolderRoot(managed.rootPath || DEFAULT_MANAGED_FOLDER_ROOT)}/{client}`,
        writable: true
      },
      public: {
        alias: "public",
        drivePath: path.posix.join(
          normalizeManagedFolderRoot(managed.rootPath || DEFAULT_MANAGED_FOLDER_ROOT),
          normalizeManagedFolderSegment(managed.publicFolder || DEFAULT_PUBLIC_FOLDER) || DEFAULT_PUBLIC_FOLDER
        ),
        writable: false
      }
    },
    userAction: "dragFilesIntoManagedFolderOrExposeReadOnlyDirectory",
    directMapping: false,
    provisioningState: text(managed.provisioningState || connectionVerifiedState(connection))
  };
}

async function provisionLocalManagedFolders(rootPath, managed = {}) {
  if (managed.enabled !== true) {
    return [];
  }
  const root = safeJoinLocal(rootPath, managed.rootPath, { allowRoot: false });
  await fs.mkdir(root.absolutePath, { recursive: true });
  const provisioned = [managed.rootPath];
  for (const client of normalizeAllowedClients(managed.allowedClients)) {
    const folderPath = normalizeDriveRelativePath(path.posix.join(managed.rootPath, client), { allowEmpty: false });
    const target = safeJoinLocal(rootPath, folderPath, { allowRoot: false });
    await fs.mkdir(target.absolutePath, { recursive: true });
    provisioned.push(folderPath);
  }
  return provisioned;
}

async function validateLocalProjectionRoot(provider, rootPath) {
  const normalizedProvider = normalizeProvider(provider || "icloud");
  const label = normalizedProvider === "icloud" ? "iCloud" : providerLabel(normalizedProvider);
  const rawPath = text(rootPath || defaultLocalProjectionRootPath(normalizedProvider));
  if (!rawPath) {
    throw new Error(`${label} rootPath 不能为空。`);
  }
  const absolutePath = path.resolve(rawPath);
  if (absolutePath === path.parse(absolutePath).root) {
    throw new Error(`不能把文件系统根目录作为 ${label} 受控根目录。`);
  }
  const stat = await fs.lstat(absolutePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`不允许连接符号链接 ${label} 根目录。`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} rootPath 必须是目录。`);
  }
  return {
    absolutePath,
    realPath: await fs.realpath(absolutePath),
    stat
  };
}

function safeJoinLocal(rootPath, drivePath = "", { allowRoot = true } = {}) {
  const relativePath = normalizeDriveRelativePath(drivePath, { allowEmpty: allowRoot });
  const root = path.resolve(rootPath);
  const absolutePath = relativePath ? path.resolve(root, ...relativePath.split("/")) : root;
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("云盘路径不能跳出受控根目录。");
  }
  return { relativePath, absolutePath };
}

async function assertExistingLocalItemWithinRoot(rootPath, drivePath = "") {
  const target = safeJoinLocal(rootPath, drivePath);
  const stat = await fs.lstat(target.absolutePath);
  if (stat.isSymbolicLink()) {
    throw new Error("不允许访问云盘受控根目录内的符号链接。");
  }
  const realPath = await fs.realpath(target.absolutePath);
  const rootRealPath = await fs.realpath(rootPath);
  if (realPath !== rootRealPath && !realPath.startsWith(`${rootRealPath}${path.sep}`)) {
    throw new Error("云盘真实路径不能跳出受控根目录。");
  }
  return { ...target, stat, realPath };
}

async function statfsSummary(rootPath) {
  if (typeof fs.statfs !== "function") {
    return { available: false };
  }
  try {
    const stats = await fs.statfs(rootPath);
    return {
      available: true,
      totalBytes: Number(stats.blocks || 0) * Number(stats.bsize || 0),
      freeBytes: Number(stats.bavail || stats.bfree || 0) * Number(stats.bsize || 0)
    };
  } catch {
    return { available: false };
  }
}

function publicConnection(connection = {}, { configFilePath = "" } = {}) {
  const provider = normalizeProvider(connection.provider);
  const directoryMappings = publicDirectoryMappings(connection);
  const remoteProvider = asObject(connection.remoteProvider, null);
  return {
    driveRef: text(connection.driveRef),
    provider,
    label: text(connection.label || providerLabel(provider)),
    mode: text(connection.mode || (isLocalProjectionProvider(provider) ? "local" : "contract")),
    requestedMode: text(connection.requestedMode || ""),
    status: text(connection.status || "active"),
    authType: text(connection.authType || (isLocalProjectionProvider(provider) ? "localDirectory" : "oauth2")),
    secretRef: text(connection.secretRef || ""),
    endpointRef: text(connection.endpointRef || ""),
    rootName: text(connection.rootName || ""),
    rootHash: text(connection.rootHash || ""),
    metadataOnly: true,
    secretPolicy: "secretRefOnly",
    contractVerified: connection.contractVerified === true,
    localAdapterVerified: connection.localAdapterVerified === true,
    remoteLiveVerified: connection.remoteLiveVerified === true,
    ...(remoteProvider ? { remoteProvider } : {}),
    managedFolder: publicManagedFolder(connection),
    directoryMappings,
    directoryMappingCount: directoryMappings.length,
    directMappingDefault: false,
    stateSemantics: {
      providerState: connectionVerifiedState(connection),
      canonicalState: "pactSharedspace",
      driveRole: "mappedDirectoryProjection",
      accessModel: "directoryMapping",
      defaultSpaceWritable: true,
      publicSpaceWritable: false,
      advancedExposuresWritableByDefault: false,
      wholeDriveAllowed: directoryMappings.some((mapping) => mapping.scope === "wholeDrive")
    },
    connectedAt: text(connection.connectedAt || ""),
    updatedAt: text(connection.updatedAt || ""),
    ...(configFilePath ? { configPath: configFilePath } : {})
  };
}

function providerManifest(config = {}, configFilePath = "") {
  const connections = Object.values(asObject(config.connections))
    .map((connection) => publicConnection(connection, { configFilePath }))
    .sort((left, right) => left.provider.localeCompare(right.provider) || left.driveRef.localeCompare(right.driveRef));
  const connectedProviders = new Set(connections.map((connection) => connection.provider));
  const providers = SUPPORTED_PROVIDERS.map((provider) => {
    const providerConnections = connections.filter((connection) => connection.provider === provider);
    const localProjectionSupported = isLocalProjectionProvider(provider);
    const hasLocalProjection = providerConnections.some((connection) => connection.localAdapterVerified === true);
    const hasRemoteLive = providerConnections.some((connection) => connection.remoteLiveVerified === true);
    const hasContract = providerConnections.some((connection) => connection.contractVerified === true);
    return {
      provider,
      label: providerLabel(provider),
      connected: connectedProviders.has(provider),
      authType: localProjectionSupported ? "localDirectory" : "oauth2",
      mode: localProjectionSupported ? "local" : "contract",
      supportedModes: provider === "icloud" ? ["local"] : localProjectionSupported ? ["local", "contract", "remote-live"] : ["contract", "remote-live"],
      secretRef: SECRET_REF_BY_PROVIDER[provider] || "",
      contractOnly: hasContract && !hasLocalProjection && !hasRemoteLive,
      localProjectionSupported,
      localProjectionVerified: hasLocalProjection,
      remoteOAuthTarget: OAUTH_PROVIDERS.has(provider),
      releaseSupport: localProjectionSupported ? "localDirectoryProjection" : "contractMode",
      capabilities: [
        "drive.connect",
        "drive.status",
        "drive.item.list",
        "drive.file.download",
        "drive.file.upload",
        "drive.sync.plan",
        "drive.sync.apply",
        "drive.permission.list"
      ]
    };
  });
  return {
    ok: true,
    schemaVersion: String(config.schemaVersion || "v0.0.1:schema:definition-1"),
    protocolVersion: CLOUD_DRIVE_PORT_PROTOCOL_VERSION,
    configPath: configFilePath,
    providerCount: providers.length,
    connectedProviderCount: connectedProviders.size,
    providers,
    connections,
    count: connections.length,
    secretPolicy: "secretRefOnly",
    contractMode: connections.some((connection) => connection.contractVerified),
    remoteLiveMode: connections.some((connection) => connection.remoteLiveVerified),
    updatedAt: text(config.updatedAt || "")
  };
}

function appendEvent(ledger, type, payload = {}) {
  const event = {
    eventId: stableId("cloud_drive_event", { type, payload, nonce: randomUUID() }),
    protocolVersion: CLOUD_DRIVE_PORT_PROTOCOL_VERSION,
    type,
    payload: clone(payload),
    createdAt: nowIso()
  };
  ledger.events.push(event);
  ledger.updatedAt = event.createdAt;
  return event;
}

function createAccessReceipt({ operationId, driveRef, drivePath = "", action = "metadata", state = "cached" } = {}) {
  const createdAt = nowIso();
  return {
    protocolVersion: "v0.0.1:storage:cloud-drive-access-receipt-1",
    receiptId: stableId("cloud_drive_access_receipt", { operationId, driveRef, drivePath, action, createdAt }),
    operationId,
    driveRef,
    drivePath,
    action,
    state,
    eventHash: digest(stableJson({ operationId, driveRef, drivePath, action, createdAt }), 64),
    createdAt
  };
}

function createCheckpoint({ operationId, driveRef, drivePath = "", action = "", state = "projected" } = {}) {
  const createdAt = nowIso();
  return {
    protocolVersion: "v0.0.1:storage:cloud-drive-checkpoint-1",
    checkpointId: stableId("cloud_drive_checkpoint", { operationId, driveRef, drivePath, action, createdAt }),
    checkpointRef: stableId("cloud_drive_checkpoint_ref", { operationId, driveRef, drivePath, action }),
    operationId,
    driveRef,
    drivePath,
    action,
    state,
    createdAt
  };
}

function createTransferReceipt({
  operationId,
  driveRef,
  drivePath = "",
  direction = "download",
  byteSize = 0,
  contentSha256 = "",
  state = "projected",
  contractVerified = false,
  localAdapterVerified = false,
  remoteLiveVerified = false,
  providerMetadata = null,
  telemetry = null
} = {}) {
  const createdAt = nowIso();
  return {
    protocolVersion: "v0.0.1:storage:cloud-drive-transfer-receipt-1",
    transferReceiptId: stableId("cloud_drive_transfer", {
      operationId,
      driveRef,
      drivePath,
      direction,
      byteSize,
      contentSha256,
      createdAt
    }),
    operationId,
    driveRef,
    drivePath,
    direction,
    byteSize,
    contentSha256,
    state,
    contractVerified,
    localAdapterVerified,
    remoteLiveVerified,
    ...(providerMetadata ? { provider: providerMetadata } : {}),
    ...(telemetry ? { telemetry: clone(telemetry) } : {}),
    createdAt
  };
}

function decodeUploadContent(input = {}) {
  if (input.contentBase64 !== undefined) {
    return Buffer.from(String(input.contentBase64 || ""), "base64");
  }
  return Buffer.from(String(input.content ?? ""), input.encoding || "utf8");
}

function contractItem(provider, connection, index = 0, mapping = null, input = {}) {
  const name = `${provider}-contract-${index + 1}.txt`;
  const folderPath = materializedMappingDrivePath(mapping || {}, connection.managedFolder, input);
  const itemPath = normalizeDriveRelativePath(path.posix.join(folderPath, name), { allowEmpty: false });
  return {
    itemId: stableId("cloud_drive_item", { provider, driveRef: connection.driveRef, name }),
    provider,
    driveRef: connection.driveRef,
    mappingId: text(mapping?.mappingId || ""),
    mappingName: text(mapping?.name || ""),
    name,
    path: itemPath,
    itemType: "file",
    mimeType: "text/plain",
    sizeBytes: 128 + index,
    metadataOnly: true,
    contractVerified: true,
    localAdapterVerified: false,
    redactions: ["downloadUrl", "privatePath", "providerNativeId", "token"]
  };
}

function remoteItem(provider, connection, rawItem = {}, index = 0) {
  const item = asObject(rawItem);
  const fallbackName = `remote-live-${index + 1}.txt`;
  const itemPath = normalizeDriveRelativePath(item.path || item.drivePath || item.name || fallbackName, { allowEmpty: false });
  const name = text(item.name || path.posix.basename(itemPath) || fallbackName);
  const providerMetadata = providerReceiptMetadata(item);
  return {
    itemId: stableId("cloud_drive_remote_item", {
      provider,
      driveRef: connection.driveRef,
      itemPath,
      providerFileId: item.providerFileId || item.fileId || item.id || ""
    }),
    provider,
    driveRef: connection.driveRef,
    name,
    path: itemPath,
    itemType: text(item.itemType || item.type || "file") === "folder" ? "folder" : "file",
    mimeType: text(item.mimeType || item.contentType || "application/octet-stream"),
    sizeBytes: Math.max(0, Number(item.sizeBytes ?? item.size ?? 0) || 0),
    modifiedAt: text(item.modifiedAt || item.updatedAt || ""),
    metadataOnly: true,
    contractVerified: false,
    localAdapterVerified: false,
    remoteLiveVerified: true,
    ...(providerMetadata ? { provider: providerMetadata } : {}),
    redactions: ["downloadUrl", "privatePath", "providerNativeId", "token", "authorization"]
  };
}

function remoteItems(provider, connection, payload = {}, limit = 200) {
  const items = Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(payload.files)
      ? payload.files
      : [];
  return items.slice(0, limit).map((item, index) => remoteItem(provider, connection, item, index));
}

async function listLocalItems(rootPath, basePath = "", { recursive = false, limit = 200, includeHash = false } = {}) {
  const start = await assertExistingLocalItemWithinRoot(rootPath, basePath);
  if (!start.stat.isDirectory()) {
    return [];
  }
  const items = [];
  async function walk(relativePath) {
    const current = safeJoinLocal(rootPath, relativePath);
    const entries = await fs.readdir(current.absolutePath, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (items.length >= limit) return;
      const itemPath = normalizeDriveRelativePath(path.posix.join(relativePath, entry.name), { allowEmpty: false });
      const absolutePath = safeJoinLocal(rootPath, itemPath, { allowRoot: false }).absolutePath;
      const stat = await fs.lstat(absolutePath);
      const isDirectory = stat.isDirectory();
      const item = {
        itemId: stableId("cloud_drive_item", { root: await fs.realpath(rootPath), itemPath }),
        name: entry.name,
        path: itemPath,
        itemType: isDirectory ? "folder" : "file",
        sizeBytes: isDirectory ? 0 : stat.size,
        modifiedAt: stat.mtime.toISOString(),
        metadataOnly: true,
        localAdapterVerified: true,
        contractVerified: false
      };
      if (includeHash && stat.isFile()) {
        item.contentSha256 = sha256Buffer(await fs.readFile(absolutePath));
      }
      items.push(item);
      if (recursive && isDirectory && !stat.isSymbolicLink()) {
        await walk(itemPath);
      }
    }
  }
  await walk(start.relativePath);
  return items;
}

function syncPlanFromItems({ connection, items, direction = "import_to_sharedspace", scope = "" } = {}) {
  const fileItems = items.filter((item) => item.itemType === "file");
  const actions = fileItems.map((item) => ({
    action: direction === "export_from_sharedspace" ? "exportProjection" : "importProjection",
    driveRef: connection.driveRef,
    provider: connection.provider,
    drivePath: item.path,
    workspaceTargetPath: normalizeDriveRelativePath(path.posix.join(scope || "cloud-drive", item.path), { allowEmpty: false }),
    sizeBytes: item.sizeBytes,
    contentSha256: item.contentSha256 || "",
    contractVerified: item.contractVerified === true,
    localAdapterVerified: item.localAdapterVerified === true,
    remoteLiveVerified: item.remoteLiveVerified === true
  }));
  return {
    dryRun: true,
    direction,
    actionCount: actions.length,
    actions,
    summary: {
      importProjection: actions.filter((action) => action.action === "importProjection").length,
      exportProjection: actions.filter((action) => action.action === "exportProjection").length,
      conflict: 0,
      noop: 0
    }
  };
}

export function createCloudDrivePort({ userDataPath = "" } = {}) {
  const configFilePath = cloudDriveConfigPath(userDataPath);
  const ledgerFilePath = cloudDriveLedgerPath(userDataPath);

  async function loadConfig() {
    const config = await readJson(configFilePath, defaultConfig());
    config.schemaVersion = "v0.0.1:schema:definition-1";
    config.protocolVersion = CLOUD_DRIVE_PORT_PROTOCOL_VERSION;
    config.connections = asObject(config.connections);
    await fs.mkdir(path.dirname(configFilePath), { recursive: true });
    await fs.access(configFilePath).catch(() => writeJson(configFilePath, config));
    return config;
  }

  async function saveConfig(config) {
    config.updatedAt = nowIso();
    await writeJson(configFilePath, config);
  }

  async function loadLedger() {
    const ledger = await readJson(ledgerFilePath, defaultLedger());
    ledger.events = asArray(ledger.events);
    ledger.transfers = asObject(ledger.transfers);
    ledger.checkpoints = asObject(ledger.checkpoints);
    ledger.accessReceipts = asObject(ledger.accessReceipts);
    await fs.mkdir(path.dirname(ledgerFilePath), { recursive: true });
    await fs.access(ledgerFilePath).catch(() => writeJson(ledgerFilePath, ledger));
    return ledger;
  }

  async function saveLedger(ledger) {
    ledger.updatedAt = nowIso();
    await writeJson(ledgerFilePath, ledger);
  }

  async function resolveConnection(input = {}) {
    const config = await loadConfig();
    const driveRef = text(input.driveRef || input.driveId || input.mountRef || "");
    const provider = normalizeProvider(input.provider || "");
    const connections = Object.values(asObject(config.connections));
    const connection = driveRef
      ? connections.find((item) => text(item.driveRef) === driveRef)
      : connections.find((item) => normalizeProvider(item.provider) === provider);
    if (!connection) {
      const error = new Error("Cloud drive connection does not exist. Call sharedspace.drive.connect first.");
      error.code = "DRIVE_CONNECTION_NOT_FOUND";
      throw error;
    }
    return { config, connection };
  }

  async function manifest() {
    const config = await loadConfig();
    return providerManifest(config, configFilePath);
  }

  async function connect(input = {}) {
    const leakedKey = containsSecretValue(input);
    if (leakedKey) {
      const error = new Error(`Cloud drive secret value must be referenced by secretRef, not inline ${leakedKey}.`);
      error.code = "INLINE_SECRET_VALUE";
      throw error;
    }
    const provider = normalizeProvider(input.provider || input.driveProvider || "icloud");
    assertSupportedProvider(provider);
    const config = await loadConfig();
    const timestamp = nowIso();
    const managedFolder = managedFolderPolicy(input, provider);
    const directoryMappings = normalizeDirectoryMappings(
      input.directoryMappings || input.exposedDirectories || input.mappedDirectories || input.mappings || [],
      managedFolder
    );
    let connection;
    let connectTelemetry = null;
    if (wantsLocalProjection(provider, input)) {
      const root = await validateLocalProjectionRoot(provider, input.rootPath || input.sourcePath || input.localPath || input.path);
      const provisionedMappings = await provisionLocalDirectoryMappings(root.realPath, directoryMappings, managedFolder);
      const driveRef = text(input.driveRef || input.driveId) || stableId("cloud_drive", {
        provider,
        root: root.realPath,
        workspaceId: input.workspaceId || ""
      });
      connection = {
        driveRef,
        provider,
        label: text(input.label || `${providerLabel(provider)} Local Projection`),
        mode: "local",
        requestedMode: text(input.mode || "local"),
        authType: "localDirectory",
        rootPath: root.realPath,
        rootName: path.basename(root.realPath),
        rootHash: digest(root.realPath, 64),
        status: "active",
        contractVerified: false,
        localAdapterVerified: true,
        managedFolder: {
          ...managedFolder,
          provisioningState: "localAdapterVerified",
          provisionedFolders: provisionedMappings.map((item) => item.drivePath)
        },
        directoryMappings: directoryMappings.map((mapping) => ({
          ...mapping,
          provisioningState: "localAdapterVerified"
        })),
        directoryProvisioning: provisionedMappings,
        connectedAt: timestamp,
        updatedAt: timestamp
      };
    } else {
      const secretRef = text(input.secretRef || SECRET_REF_BY_PROVIDER[provider] || "");
      if (!secretRef.startsWith("secret://")) {
        const error = new Error("Cloud drive OAuth provider connection requires a secret:// secretRef.");
        error.code = "SECRET_REF_REQUIRED";
        throw error;
      }
      const adapterMode = normalizeRemoteAdapterMode(input.mode || input.requestedMode || "contract");
      const endpointUrl = adapterMode === "remote-live"
        ? normalizeEndpointUrl(input.endpointUrl || input.remoteEndpointUrl || input.baseUrl || "")
        : "";
      const driveRef = text(input.driveRef || input.driveId) || stableId("cloud_drive", {
        provider,
        secretRef,
        workspaceId: input.workspaceId || "",
        mode: adapterMode,
        endpointUrl
      });
      const endpointRef = text(input.endpointRef || `config://pact/drive/${provider}-endpoint`);
      let providerConnection = null;
      if (adapterMode === "remote-live") {
        const remote = await callRemoteProvider({
          driveRef,
          provider,
          mode: adapterMode,
          secretRef,
          endpointRef,
          endpointUrl
        }, "connect", {
          workspaceId: text(input.workspaceId || ""),
          managedFolder,
          directoryMappings: publicDirectoryMappings({ directoryMappings, managedFolder }),
          requestedAt: timestamp
        });
        providerConnection = asObject(remote.payload.connection || remote.payload.drive || remote.payload);
        connectTelemetry = remote.telemetry;
      }
      const provisioningState = adapterMode === "remote-live" ? "remoteLiveVerified" : "contractVerified";
      connection = {
        driveRef,
        provider,
        label: text(input.label || `${providerLabel(provider)} ${adapterMode === "remote-live" ? "Remote Live Adapter" : "Contract Adapter"}`),
        mode: adapterMode,
        requestedMode: text(input.mode || adapterMode),
        authType: text(input.authType || "oauth2"),
        secretRef,
        endpointRef,
        ...(endpointUrl ? { endpointUrl } : {}),
        rootName: text(providerConnection?.rootName || providerConnection?.name || "") || `${provider}-${adapterMode}-root`,
        rootHash: digest(`${provider}:${endpointUrl || endpointRef}:${secretRef}`, 64),
        status: "active",
        contractVerified: adapterMode !== "remote-live",
        localAdapterVerified: false,
        remoteLiveVerified: adapterMode === "remote-live",
        ...(providerConnection ? {
          remoteProvider: {
            rootId: text(providerConnection.rootId || providerConnection.id || ""),
            rootName: text(providerConnection.rootName || providerConnection.name || ""),
            revision: text(providerConnection.revision || providerConnection.version || ""),
            accountId: text(providerConnection.accountId || providerConnection.tenantId || ""),
            telemetry: connectTelemetry
          }
        } : {}),
        managedFolder: {
          ...managedFolder,
          provisioningState,
          provisionedFolders: directoryMappings.map((mapping) => mapping.displayPath)
        },
        directoryMappings: directoryMappings.map((mapping) => ({
          ...mapping,
          provisioningState
        })),
        directoryProvisioning: directoryMappings.map((mapping) => ({
          mappingId: mapping.mappingId,
          drivePath: mapping.displayPath,
          state: provisioningState
        })),
        connectedAt: timestamp,
        updatedAt: timestamp
      };
    }
    config.connections[connection.driveRef] = {
      ...(config.connections[connection.driveRef] || {}),
      ...connection,
      connectedAt: config.connections[connection.driveRef]?.connectedAt || connection.connectedAt,
      updatedAt: timestamp
    };
    await saveConfig(config);
    const ledger = await loadLedger();
    appendEvent(ledger, "sharedspace.drive.connect", {
      driveRef: connection.driveRef,
      provider,
      mode: connection.mode,
      contractVerified: connection.contractVerified === true,
      localAdapterVerified: connection.localAdapterVerified === true,
      remoteLiveVerified: connection.remoteLiveVerified === true,
      ...(connectTelemetry ? { telemetry: connectTelemetry } : {}),
      managedFolderRoot: connection.managedFolder?.rootPath || DEFAULT_MANAGED_FOLDER_ROOT,
      directoryMappingCount: connection.directoryMappings?.length || 0,
      directoryMappings: publicDirectoryMappings(connection),
      directMappingDefault: false,
      defaultSpaceWritable: true,
      publicSpaceWritable: false,
      wholeDriveAllowed: publicDirectoryMappings(connection).some((mapping) => mapping.scope === "wholeDrive")
    });
    await saveLedger(ledger);
    return {
      ok: true,
      protocolVersion: CLOUD_DRIVE_PORT_PROTOCOL_VERSION,
      provider,
      drive: publicConnection(config.connections[connection.driveRef], { configFilePath }),
      manifest: providerManifest(config, configFilePath),
      secretPolicy: "secretRefOnly",
      contractVerified: connection.contractVerified === true,
      localAdapterVerified: connection.localAdapterVerified === true,
      remoteLiveVerified: connection.remoteLiveVerified === true,
      ...(connectTelemetry ? { telemetry: connectTelemetry } : {})
    };
  }

  async function status(input = {}) {
    const config = await loadConfig();
    const manifestPayload = providerManifest(config, configFilePath);
    for (const connection of manifestPayload.connections) {
      const privateConnection = config.connections[connection.driveRef];
      if (isLocalProjectionConnection(privateConnection)) {
        connection.quota = await statfsSummary(privateConnection.rootPath);
        connection.syncStatus = fsSync.existsSync(privateConnection.rootPath)
          ? "localAdapterVerified"
          : "unavailable";
      }
    }
    const providerFilter = normalizeProvider(input.provider || "");
    const driveRef = text(input.driveRef || input.driveId || "");
    manifestPayload.connections = manifestPayload.connections.filter((connection) =>
      (!providerFilter || connection.provider === providerFilter) &&
      (!driveRef || connection.driveRef === driveRef)
    );
    manifestPayload.count = manifestPayload.connections.length;
    return manifestPayload;
  }

  async function listItems(input = {}) {
    const { connection } = await resolveConnection(input);
    const ledger = await loadLedger();
    const requestedPath = input.path || input.folderPath || "";
    const recursive = ["1", "true", "yes"].includes(text(input.recursive ?? "false").toLowerCase());
    const includeHash = ["1", "true", "yes"].includes(text(input.includeHash ?? input["include-hash"] ?? "false").toLowerCase());
    const limit = Math.max(1, Math.min(Number(input.limit || 200) || 200, 1000));
    const hasRequestedPath = text(requestedPath) !== "";
    let items;
    let basePath = "";
    let mapping = null;
    let listTelemetry = null;
    if (isLocalProjectionConnection(connection)) {
      if (hasRequestedPath) {
        const resolved = resolveMappedDrivePath(connection, requestedPath, { allowRoot: true, input });
        basePath = resolved.drivePath;
        mapping = resolved.mapping;
        items = await listLocalItems(connection.rootPath, basePath, { recursive, includeHash, limit });
      } else {
        const collected = [];
        for (const directoryMapping of normalizeDirectoryMappings(connection.directoryMappings || [], connection.managedFolder)) {
          if (collected.length >= limit) break;
          assertMappingAccess(directoryMapping, input);
          const mappedBasePath = materializedMappingDrivePath(directoryMapping, connection.managedFolder, input);
          const mappedItems = await listLocalItems(connection.rootPath, mappedBasePath, {
            recursive,
            includeHash,
            limit: limit - collected.length
          });
          collected.push(...mappedItems.map((item) => ({
            ...item,
            mappingId: directoryMapping.mappingId,
            mappingName: directoryMapping.name
          })));
        }
        basePath = "/";
        items = collected;
      }
      items = items.map((item) => ({
        ...item,
        provider: connection.provider,
        driveRef: connection.driveRef
      }));
    } else if (isRemoteLiveConnection(connection)) {
      if (hasRequestedPath) {
        const resolved = resolveMappedDrivePath(connection, requestedPath, { allowRoot: true, input });
        basePath = resolved.drivePath || "/";
        mapping = resolved.mapping;
      } else {
        basePath = "/";
      }
      const remote = await callRemoteProvider(connection, "list", {
        workspaceId: text(input.workspaceId || ""),
        clientId: subjectForInput(input),
        path: basePath,
        recursive,
        includeHash,
        limit,
        directoryMappings: publicDirectoryMappings(connection)
      });
      listTelemetry = remote.telemetry;
      items = remoteItems(connection.provider, connection, remote.payload, limit);
    } else {
      if (hasRequestedPath) {
        const resolved = resolveMappedDrivePath(connection, requestedPath, { allowRoot: true, input });
        basePath = resolved.drivePath;
        mapping = resolved.mapping;
        items = [contractItem(connection.provider, connection, 0, mapping, input)].slice(0, limit);
      } else {
        basePath = "/";
        items = contractItemsForMappings(connection.provider, connection, limit, input);
      }
    }
    const accessReceipt = createAccessReceipt({
      operationId: input.operationId || "sharedspace.drive.item.list",
      driveRef: connection.driveRef,
      drivePath: basePath || "/",
      action: "drive.item.list",
      state: connection.contractVerified ? "contractVerified" : isRemoteLiveConnection(connection) ? "remoteLiveVerified" : "cached"
    });
    ledger.accessReceipts[accessReceipt.receiptId] = accessReceipt;
    appendEvent(ledger, "sharedspace.drive.item.list", {
      driveRef: connection.driveRef,
      provider: connection.provider,
      basePath,
      itemCount: items.length,
      contractVerified: connection.contractVerified === true,
      remoteLiveVerified: connection.remoteLiveVerified === true,
      ...(listTelemetry ? { telemetry: listTelemetry } : {})
    });
    await saveLedger(ledger);
    return {
      ok: true,
      protocolVersion: CLOUD_DRIVE_PORT_PROTOCOL_VERSION,
      drive: publicConnection(connection, { configFilePath }),
      basePath,
      requestedPath: hasRequestedPath ? normalizeMappingDrivePath(requestedPath, { allowRoot: true }) : "",
      mapping: mapping ? publicMapping(mapping) : null,
      items,
      paths: items.map((item) => item.path),
      count: items.length,
      metadataPolicy: "safeMetadataOnly",
      accessReceipt,
      contractVerified: connection.contractVerified === true,
      localAdapterVerified: connection.localAdapterVerified === true,
      remoteLiveVerified: connection.remoteLiveVerified === true,
      ...(listTelemetry ? { telemetry: listTelemetry } : {})
    };
  }

  async function downloadFile(input = {}) {
    const { connection } = await resolveConnection(input);
    const ledger = await loadLedger();
    const resolved = resolveMappedDrivePath(connection, input.path || input.filePath || input.itemPath || "", {
      allowRoot: false,
      input
    });
    const drivePath = resolved.drivePath;
    let content = Buffer.from(`Contract drive content for ${connection.provider}:${drivePath}\n`, "utf8");
    let localAdapterVerified = false;
    let remoteReadInvoked = false;
    let providerMetadata = null;
    let telemetry = null;
    if (isRemoteLiveConnection(connection)) {
      const remote = await callRemoteProvider(connection, "download", {
        workspaceId: text(input.workspaceId || ""),
        clientId: subjectForInput(input),
        path: drivePath,
        requestedPath: resolved.requestedPath
      });
      const remotePayload = asObject(remote.payload.file || remote.payload.download || remote.payload);
      if (remotePayload.contentBase64 !== undefined) {
        content = Buffer.from(String(remotePayload.contentBase64 || ""), "base64");
      } else {
        content = Buffer.from(String(remotePayload.content || ""), remotePayload.encoding || "utf8");
      }
      const expectedSha256 = text(remotePayload.contentSha256 || remotePayload.sha256 || "");
      const actualSha256 = sha256Buffer(content);
      if (expectedSha256 && expectedSha256 !== actualSha256) {
        const error = new Error("Remote cloud drive provider content digest mismatch.");
        error.code = "REMOTE_CONTENT_DIGEST_MISMATCH";
        throw error;
      }
      providerMetadata = providerReceiptMetadata(remotePayload);
      telemetry = remote.telemetry;
      remoteReadInvoked = true;
    } else if (isLocalProjectionConnection(connection)) {
      const target = await assertExistingLocalItemWithinRoot(connection.rootPath, drivePath);
      if (!target.stat.isFile()) {
        const error = new Error("云盘下载目标必须是文件。");
        error.code = "DRIVE_TARGET_NOT_FILE";
        throw error;
      }
      content = await fs.readFile(target.absolutePath);
      localAdapterVerified = true;
    }
    const contentSha256 = sha256Buffer(content);
    const transferReceipt = createTransferReceipt({
      operationId: input.operationId || "sharedspace.drive.file.download",
      driveRef: connection.driveRef,
      drivePath,
      direction: "download",
      byteSize: content.length,
      contentSha256,
      state: connection.contractVerified ? "contractVerified" : isRemoteLiveConnection(connection) ? "remoteLiveVerified" : "staged",
      contractVerified: connection.contractVerified === true,
      localAdapterVerified,
      remoteLiveVerified: connection.remoteLiveVerified === true,
      providerMetadata,
      telemetry
    });
    const accessReceipt = createAccessReceipt({
      operationId: input.operationId || "sharedspace.drive.file.download",
      driveRef: connection.driveRef,
      drivePath,
      action: "drive.file.download",
      state: connection.contractVerified ? "contractVerified" : isRemoteLiveConnection(connection) ? "remoteLiveVerified" : "staged"
    });
    ledger.transfers[transferReceipt.transferReceiptId] = transferReceipt;
    ledger.accessReceipts[accessReceipt.receiptId] = accessReceipt;
    appendEvent(ledger, "sharedspace.drive.file.download", {
      driveRef: connection.driveRef,
      provider: connection.provider,
      drivePath,
      byteSize: content.length,
      contentSha256,
      remoteReadInvoked,
      contractVerified: connection.contractVerified === true,
      localAdapterVerified,
      remoteLiveVerified: connection.remoteLiveVerified === true,
      ...(providerMetadata ? { provider: providerMetadata } : {}),
      ...(telemetry ? { telemetry } : {})
    });
    await saveLedger(ledger);
    const includeText = !["0", "false", "no"].includes(text(input.includeText ?? input["include-text"] ?? "true").toLowerCase());
    return {
      ok: true,
      protocolVersion: CLOUD_DRIVE_PORT_PROTOCOL_VERSION,
      drive: publicConnection(connection, { configFilePath }),
      path: drivePath,
      requestedPath: resolved.requestedPath,
      mapping: publicMapping(resolved.mapping),
      byteSize: content.length,
      contentSha256,
      contentBase64: content.toString("base64"),
      ...(includeText ? { content: content.toString(input.encoding || "utf8") } : {}),
      transferReceipt,
      accessReceipt,
      remoteReadInvoked,
      ...(providerMetadata ? { providerReceipt: providerMetadata } : {}),
      ...(telemetry ? { telemetry } : {}),
      contractVerified: connection.contractVerified === true,
      localAdapterVerified,
      remoteLiveVerified: connection.remoteLiveVerified === true
    };
  }

  async function uploadFile(input = {}) {
    const { connection } = await resolveConnection(input);
    const ledger = await loadLedger();
    const resolved = resolveMappedDrivePath(
      connection,
      input.path || input.filePath || path.posix.join(input.parentPath || "", input.name || "upload.txt"),
      { allowRoot: false, input }
    );
    const drivePath = resolved.drivePath;
    assertMappingWrite(connection, resolved, input);
    const content = decodeUploadContent(input);
    const contentSha256 = sha256Buffer(content);
    const policyDecision = {
      protocolVersion: "v0.0.1:storage:cloud-drive-policy-decision-1",
      decisionId: stableId("cloud_drive_policy", {
        driveRef: connection.driveRef,
        drivePath,
        contentSha256,
        operationId: input.operationId || "sharedspace.drive.file.upload"
      }),
      decision: "allow",
      reason: "v0.0.1 cloud drive upload is mediated by Pact operation and secretRef policy.",
      requiresCheckpoint: true,
      createdAt: nowIso()
    };
    let localAdapterVerified = false;
    let remoteWriteInvoked = false;
    let providerMetadata = null;
    let telemetry = null;
    if (isRemoteLiveConnection(connection)) {
      const remote = await callRemoteProvider(connection, "upload", {
        workspaceId: text(input.workspaceId || ""),
        clientId: subjectForInput(input),
        path: drivePath,
        requestedPath: resolved.requestedPath,
        contentBase64: content.toString("base64"),
        byteSize: content.length,
        contentSha256,
        overwrite: input.overwrite === true
      });
      const remotePayload = asObject(remote.payload.file || remote.payload.upload || remote.payload);
      const providerSha256 = text(remotePayload.contentSha256 || remotePayload.sha256 || "");
      if (providerSha256 && providerSha256 !== contentSha256) {
        const error = new Error("Remote cloud drive provider upload digest mismatch.");
        error.code = "REMOTE_UPLOAD_DIGEST_MISMATCH";
        throw error;
      }
      providerMetadata = providerReceiptMetadata(remotePayload);
      telemetry = remote.telemetry;
      remoteWriteInvoked = true;
    } else if (isLocalProjectionConnection(connection)) {
      const target = safeJoinLocal(connection.rootPath, drivePath, { allowRoot: false });
      const exists = fsSync.existsSync(target.absolutePath);
      if (exists && input.overwrite !== true) {
        const error = new Error("云盘目标文件已存在；覆盖需要 overwrite=true。");
        error.code = "DRIVE_TARGET_EXISTS";
        throw error;
      }
      await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });
      await fs.writeFile(target.absolutePath, content);
      localAdapterVerified = true;
    }
    const checkpoint = createCheckpoint({
      operationId: input.operationId || "sharedspace.drive.file.upload",
      driveRef: connection.driveRef,
      drivePath,
      action: "drive.file.upload",
      state: connection.contractVerified ? "contractVerified" : isRemoteLiveConnection(connection) ? "remoteLiveVerified" : "projected"
    });
    const transferReceipt = createTransferReceipt({
      operationId: input.operationId || "sharedspace.drive.file.upload",
      driveRef: connection.driveRef,
      drivePath,
      direction: "upload",
      byteSize: content.length,
      contentSha256,
      state: connection.contractVerified ? "contractVerified" : isRemoteLiveConnection(connection) ? "remoteLiveVerified" : "projected",
      contractVerified: connection.contractVerified === true,
      localAdapterVerified,
      remoteLiveVerified: connection.remoteLiveVerified === true,
      providerMetadata,
      telemetry
    });
    ledger.checkpoints[checkpoint.checkpointId] = checkpoint;
    ledger.transfers[transferReceipt.transferReceiptId] = transferReceipt;
    appendEvent(ledger, "sharedspace.drive.file.upload", {
      driveRef: connection.driveRef,
      provider: connection.provider,
      drivePath,
      byteSize: content.length,
      contentSha256,
      remoteWriteInvoked,
      localWriteInvoked: isLocalProjectionConnection(connection),
      contractVerified: connection.contractVerified === true,
      localAdapterVerified,
      remoteLiveVerified: connection.remoteLiveVerified === true,
      ...(providerMetadata ? { provider: providerMetadata } : {}),
      ...(telemetry ? { telemetry } : {})
    });
    await saveLedger(ledger);
    return {
      ok: true,
      protocolVersion: CLOUD_DRIVE_PORT_PROTOCOL_VERSION,
      drive: publicConnection(connection, { configFilePath }),
      path: drivePath,
      requestedPath: resolved.requestedPath,
      mapping: publicMapping(resolved.mapping),
      byteSize: content.length,
      contentSha256,
      policyDecision,
      checkpoint,
      transferReceipt,
      remoteWriteInvoked,
      localWriteInvoked: isLocalProjectionConnection(connection),
      ...(providerMetadata ? { providerReceipt: providerMetadata } : {}),
      ...(telemetry ? { telemetry } : {}),
      contractVerified: connection.contractVerified === true,
      localAdapterVerified,
      remoteLiveVerified: connection.remoteLiveVerified === true
    };
  }

  async function syncPlan(input = {}) {
    const { connection } = await resolveConnection(input);
    const requestedPath = input.path || input.scope || "";
    const hasRequestedPath = text(requestedPath) !== "";
    const direction = text(input.direction || "import_to_sharedspace");
    const limit = Math.max(1, Math.min(Number(input.limit || 200) || 200, 1000));
    let basePath = "/";
    let mapping = null;
    let items = [];
    let telemetry = null;
    if (hasRequestedPath) {
      const resolved = resolveMappedDrivePath(connection, requestedPath, { allowRoot: true, input });
      basePath = resolved.drivePath || "/";
      mapping = resolved.mapping;
      if (isLocalProjectionConnection(connection)) {
        items = await listLocalItems(connection.rootPath, resolved.drivePath, { recursive: true, includeHash: true, limit });
      } else if (isRemoteLiveConnection(connection)) {
        const remote = await callRemoteProvider(connection, "list", {
          workspaceId: text(input.workspaceId || ""),
          clientId: subjectForInput(input),
          path: basePath,
          recursive: true,
          includeHash: true,
          limit,
          directoryMappings: publicDirectoryMappings(connection)
        });
        telemetry = remote.telemetry;
        items = remoteItems(connection.provider, connection, remote.payload, limit);
      } else {
        items = [contractItem(connection.provider, connection, 0, mapping, input)];
      }
    } else if (isLocalProjectionConnection(connection)) {
      for (const directoryMapping of normalizeDirectoryMappings(connection.directoryMappings || [], connection.managedFolder)) {
        if (items.length >= limit) break;
        assertMappingAccess(directoryMapping, input);
        const mappedBasePath = materializedMappingDrivePath(directoryMapping, connection.managedFolder, input);
        const mappedItems = await listLocalItems(connection.rootPath, mappedBasePath, {
          recursive: true,
          includeHash: true,
          limit: limit - items.length
        });
        items.push(...mappedItems);
      }
    } else if (isRemoteLiveConnection(connection)) {
      const remote = await callRemoteProvider(connection, "list", {
        workspaceId: text(input.workspaceId || ""),
        clientId: subjectForInput(input),
        path: basePath,
        recursive: true,
        includeHash: true,
        limit,
        directoryMappings: publicDirectoryMappings(connection)
      });
      telemetry = remote.telemetry;
      items = remoteItems(connection.provider, connection, remote.payload, limit);
    } else {
      items = contractItemsForMappings(connection.provider, connection, limit, input);
    }
    const plan = syncPlanFromItems({
      connection,
      items,
      direction,
      scope: input.workspaceTargetPath || input.targetPath || "cloud-drive"
    });
    return {
      ok: true,
      protocolVersion: CLOUD_DRIVE_PORT_PROTOCOL_VERSION,
      drive: publicConnection(connection, { configFilePath }),
      basePath,
      requestedPath: hasRequestedPath ? normalizeMappingDrivePath(requestedPath, { allowRoot: true }) : "",
      mapping: mapping ? publicMapping(mapping) : null,
      ...plan,
      ...(telemetry ? { telemetry } : {}),
      contractVerified: connection.contractVerified === true,
      localAdapterVerified: connection.localAdapterVerified === true,
      remoteLiveVerified: connection.remoteLiveVerified === true
    };
  }

  async function syncApply(input = {}) {
    const { connection } = await resolveConnection(input);
    const ledger = await loadLedger();
    const plan = await syncPlan(input);
    const checkpoint = createCheckpoint({
      operationId: input.operationId || "sharedspace.drive.sync.apply",
      driveRef: connection.driveRef,
      drivePath: plan.basePath || "/",
      action: "drive.sync.apply",
      state: connection.contractVerified ? "contractVerified" : isRemoteLiveConnection(connection) ? "remoteLiveVerified" : "projected"
    });
    const syncReceipt = {
      protocolVersion: "v0.0.1:storage:cloud-drive-sync-receipt-1",
      syncReceiptId: stableId("cloud_drive_sync", {
        driveRef: connection.driveRef,
        basePath: plan.basePath,
        direction: plan.direction,
        actionCount: plan.actionCount,
        createdAt: checkpoint.createdAt
      }),
      operationId: input.operationId || "sharedspace.drive.sync.apply",
      driveRef: connection.driveRef,
      direction: plan.direction,
      actionCount: plan.actionCount,
      state: connection.contractVerified ? "contractVerified" : isRemoteLiveConnection(connection) ? "remoteLiveVerified" : "projected",
      remoteSyncInvoked: false,
      contractVerified: connection.contractVerified === true,
      localAdapterVerified: connection.localAdapterVerified === true,
      remoteLiveVerified: connection.remoteLiveVerified === true,
      createdAt: nowIso()
    };
    ledger.checkpoints[checkpoint.checkpointId] = checkpoint;
    appendEvent(ledger, "sharedspace.drive.sync.apply", {
      driveRef: connection.driveRef,
      provider: connection.provider,
      direction: plan.direction,
      actionCount: plan.actionCount,
      syncReceiptId: syncReceipt.syncReceiptId,
      contractVerified: connection.contractVerified === true,
      remoteLiveVerified: connection.remoteLiveVerified === true
    });
    await saveLedger(ledger);
    return {
      ...plan,
      dryRun: false,
      checkpoint,
      syncReceipt,
      appliedActions: connection.contractVerified ? [] : plan.actions,
      remoteSyncInvoked: false,
      contractVerified: connection.contractVerified === true,
      localAdapterVerified: connection.localAdapterVerified === true,
      remoteLiveVerified: connection.remoteLiveVerified === true
    };
  }

  async function permissionList(input = {}) {
    const { connection } = await resolveConnection(input);
    const requestedPath = input.path || input.itemPath || "";
    const hasRequestedPath = text(requestedPath) !== "";
    const resolved = hasRequestedPath
      ? resolveMappedDrivePath(connection, requestedPath, { allowRoot: true, input })
      : null;
    const drivePath = resolved?.drivePath || "/";
    const mappings = resolved ? [resolved.mapping] : normalizeDirectoryMappings(connection.directoryMappings || [], connection.managedFolder);
    return {
      ok: true,
      protocolVersion: CLOUD_DRIVE_PORT_PROTOCOL_VERSION,
      drive: publicConnection(connection, { configFilePath }),
      path: drivePath,
      permissions: mappings.map((mapping) => {
        const policy = normalizeAccessPolicy(mapping.accessPolicy);
        return {
          permissionId: stableId("cloud_drive_permission", {
            driveRef: connection.driveRef,
            drivePath: mapping.drivePath || "/",
            principal: policy.mode
          }),
          principal: policy.defaultEveryone ? "all-clients" : policy.subjects.join(","),
          role: policy.mode === "allowlist"
            ? "managed-folder-allowlist"
            : policy.mode === "denylist"
              ? "managed-folder-denylist"
              : "managed-folder-access",
          mode: policy.mode,
          subjects: policy.subjects,
          defaultEveryone: policy.defaultEveryone,
          mappingId: mapping.mappingId,
          mappingName: mapping.name,
          spaceKind: mapping.spaceKind,
          writable: mapping.writable === true,
          writePolicy: mapping.writePolicy,
          drivePath: mapping.displayPath,
          inherited: !hasRequestedPath,
          metadataOnly: true,
          contractVerified: connection.contractVerified === true,
          remoteLiveVerified: connection.remoteLiveVerified === true
        };
      }),
      redactions: ["shareLink", "providerNativeId", "token"],
      contractVerified: connection.contractVerified === true,
      localAdapterVerified: connection.localAdapterVerified === true,
      remoteLiveVerified: connection.remoteLiveVerified === true
    };
  }

  return {
    manifest,
    connect,
    status,
    listItems,
    downloadFile,
    uploadFile,
    syncPlan,
    syncApply,
    permissionList
  };
}
