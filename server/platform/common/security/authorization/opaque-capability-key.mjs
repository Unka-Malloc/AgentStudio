import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ServerConfig } from "../../config/ServerConfig.mjs";
import {
  normalizeKernelCapabilities,
  unknownKernelCapabilities
} from "./authorization-engine.mjs";

export const OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION = "pact.opaque-capability-key.v1";

const DEFAULT_ALIAS = "pact-opaque-capability-key";
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const VALID_STATUSES = Object.freeze(["valid", "invalid"]);
const KERNEL_STATE_VERSION = 1;
const RECOVERY_PACKAGE_VERSION = "pact.capability-kernel-recovery.v1";
const AEAD_ALGORITHM = "aes-256-gcm";

function repoRoot() {
  return path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)));
}

function helperScriptPath() {
  return path.join(repoRoot(), "server", "scripts", "pact-opaque-capability-key-helper.mjs");
}

function nowIso() {
  return new Date().toISOString();
}

function parseIso(value = "") {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function text(value) {
  return String(value || "").trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function stableJson(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed === undefined || parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function resolveDataDir(dataDir = "") {
  return path.resolve(text(dataDir) || ServerConfig.getDataDir());
}

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writePrivateFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  ensurePrivateDir(dir);
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`
  );
  let handle = null;
  try {
    handle = await fs.promises.open(tempPath, "wx", 0o600);
    await handle.writeFile(content, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.promises.chmod(tempPath, 0o600).catch(() => {});
    await fs.promises.rename(tempPath, filePath);
    await fs.promises.chmod(filePath, 0o600).catch(() => {});
    const dirHandle = await fs.promises.open(dir, "r").catch(() => null);
    try {
      await dirHandle?.sync();
    } finally {
      await dirHandle?.close();
    }
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await fs.promises.unlink(tempPath).catch(() => {});
    throw error;
  }
  return filePath;
}

function safeAlias(value = DEFAULT_ALIAS) {
  return text(value || DEFAULT_ALIAS).replace(/[^a-zA-Z0-9._:-]/g, "_") || DEFAULT_ALIAS;
}

export function capabilityKernelStatePath({ dataDir = "", alias = DEFAULT_ALIAS } = {}) {
  return path.join(resolveDataDir(dataDir), "security", "capability-kernel", `${safeAlias(alias)}.sealed.json`);
}

function capabilityKernelLocalSealingKeyPath({ dataDir = "", alias = DEFAULT_ALIAS } = {}) {
  return path.join(resolveDataDir(dataDir), "security", "capability-kernel", `${safeAlias(alias)}.sealing-key`);
}

function capabilityKernelLockPath({ dataDir = "", alias = DEFAULT_ALIAS } = {}) {
  return path.join(resolveDataDir(dataDir), "security", "locks", `capability-kernel-${safeAlias(alias)}.lock`);
}

async function withPrivateFileLock(lockPath, action, { timeoutMs = 10000, staleMs = 30000 } = {}) {
  ensurePrivateDir(path.dirname(lockPath));
  const startedAt = Date.now();
  while (true) {
    let handle = null;
    try {
      handle = await fs.promises.open(lockPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({
        pid: process.pid,
        createdAt: nowIso()
      }));
      await handle.close();
      handle = null;
      try {
        return await action();
      } finally {
        await fs.promises.unlink(lockPath).catch(() => {});
      }
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
      }
      if (error?.code !== "EEXIST") {
        throw error;
      }
      const stat = await fs.promises.stat(lockPath).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > staleMs) {
        await fs.promises.unlink(lockPath).catch(() => {});
        continue;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for capability kernel state lock: ${lockPath}`);
      }
      await sleep(20 + Math.floor(Math.random() * 30));
    }
  }
}

export function canonicalOpaqueCapabilities(capabilities = []) {
  return normalizeKernelCapabilities(capabilities).sort();
}

function rejectUnknownOpaqueCapabilities(capabilities = []) {
  const unknown = unknownKernelCapabilities(capabilities);
  if (unknown.length > 0) {
    throw new Error(`Unknown opaque capability permission: ${unknown.join(", ")}`);
  }
}

export function opaqueCapabilityHash(capabilities = []) {
  return crypto.createHash("sha256").update(stableJson(canonicalOpaqueCapabilities(capabilities))).digest("base64url");
}

export function createCapabilityKey() {
  return `ock_${crypto.randomBytes(32).toString("base64url")}`;
}

export function capabilityKeyHash(runtimeLookupKey, capabilityKey = "") {
  const key = Buffer.isBuffer(runtimeLookupKey)
    ? runtimeLookupKey
    : Buffer.from(String(runtimeLookupKey || ""), "base64");
  if (key.length < 32) {
    throw new Error("Capability key lookup requires a 256-bit runtime lookup key.");
  }
  return crypto.createHmac("sha256", key).update(String(capabilityKey || ""), "utf8").digest("base64url");
}

export function capabilityPermissionHash(runtimeLookupKey, capability = "") {
  const key = Buffer.isBuffer(runtimeLookupKey)
    ? runtimeLookupKey
    : Buffer.from(String(runtimeLookupKey || ""), "base64");
  if (key.length < 32) {
    throw new Error("Capability permission lookup requires a 256-bit runtime lookup key.");
  }
  return crypto.createHmac("sha256", key).update(String(capability || ""), "utf8").digest("base64url");
}

function normalizeStatus(status = "valid") {
  const value = text(status || "valid");
  return VALID_STATUSES.includes(value) ? value : "invalid";
}

function candidateCapabilitiesFor(requiredCapability = "") {
  const capability = text(requiredCapability);
  if (!capability) {
    return [];
  }
  const candidates = [capability];
  if (capability.startsWith("cap:api:")) {
    candidates.push("cap:api:*");
  }
  if (capability.startsWith("cap:tool:")) {
    candidates.push("cap:tool:*");
  }
  candidates.push("cap:*");
  return [...new Set(candidates)];
}

function publicKeyRecord(record = null) {
  if (!record) {
    return null;
  }
  return {
    protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
    keyHash: record.keyHash,
    credentialId: record.credentialId,
    status: normalizeStatus(record.status),
    capabilitySetHash: record.capabilitySetHash || "",
    capabilityCount: Number(record.capabilityCount || 0),
    constraints: asObject(record.constraints),
    grantVersion: Number(record.grantVersion || 1),
    metadata: asObject(record.metadata),
    issuedAt: record.issuedAt || "",
    expiresAt: record.expiresAt || "",
    invalidatedAt: record.invalidatedAt || "",
    invalidationReason: record.invalidationReason || "",
    createdAt: record.createdAt || "",
    updatedAt: record.updatedAt || ""
  };
}

function createKeyRecord({
  keyHash = "",
  credentialId = `opq_cap_${crypto.randomUUID()}`,
  capabilities = [],
  constraints = {},
  ttlMs = DEFAULT_TTL_MS,
  issuedAt = nowIso(),
  expiresAt = "",
  grantVersion = 1,
  metadata = {},
  status = "valid"
} = {}) {
  const normalizedCapabilities = canonicalOpaqueCapabilities(capabilities);
  if (!keyHash) {
    throw new Error("Capability key binding requires a key hash.");
  }
  if (normalizedCapabilities.length === 0) {
    throw new Error("Capability key binding requires at least one kernel capability.");
  }
  const timestamp = nowIso();
  return publicKeyRecord({
    keyHash,
    credentialId: text(credentialId) || `opq_cap_${crypto.randomUUID()}`,
    status,
    capabilitySetHash: opaqueCapabilityHash(normalizedCapabilities),
    capabilityCount: normalizedCapabilities.length,
    constraints: asObject(constraints),
    grantVersion: Number(grantVersion || 1),
    metadata: asObject(metadata),
    issuedAt,
    expiresAt: expiresAt || new Date(parseIso(issuedAt) + Math.max(1, Number(ttlMs || DEFAULT_TTL_MS))).toISOString(),
    invalidatedAt: "",
    invalidationReason: "",
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function validateKeyRecord(record = null, { now = nowIso(), minGrantVersion = 0 } = {}) {
  if (!record) {
    return { ok: false, reasonCode: "capability_key_unknown" };
  }
  const normalized = publicKeyRecord(record);
  if (normalized.status !== "valid") {
    return {
      ok: false,
      reasonCode: "capability_key_invalid",
      status: normalized.status,
      credentialId: normalized.credentialId
    };
  }
  if (Number(normalized.grantVersion || 0) < Number(minGrantVersion || 0)) {
    return { ok: false, reasonCode: "credential_grant_version_stale", credentialId: normalized.credentialId };
  }
  if (normalized.expiresAt && parseIso(normalized.expiresAt) <= parseIso(now)) {
    return { ok: false, reasonCode: "capability_key_expired", credentialId: normalized.credentialId };
  }
  return { ok: true, record: normalized };
}

function hashBase64Url(value = "") {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("base64url");
}

function randomBase64(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64");
}

function keychainService(alias = DEFAULT_ALIAS) {
  return `com.unka-malloc.pact.capability-kernel.${safeAlias(alias)}`;
}

function createEmptyKernelState({ provider = "memory", securityMode = "memory", runtimeLookupKeyBase64 = "" } = {}) {
  const timestamp = nowIso();
  return normalizeKernelState({
    stateVersion: KERNEL_STATE_VERSION,
    provider,
    securityMode,
    epoch: 1,
    runtimeLookupKeyBase64: runtimeLookupKeyBase64 || randomBase64(32),
    records: [],
    permissions: [],
    events: [],
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function normalizeKernelState(input = {}) {
  const state = asObject(input);
  const normalized = {
    stateVersion: Number(state.stateVersion || KERNEL_STATE_VERSION),
    provider: text(state.provider || "unknown"),
    securityMode: text(state.securityMode || "unknown"),
    epoch: Math.max(1, Number(state.epoch || 1)),
    runtimeLookupKeyBase64: text(state.runtimeLookupKeyBase64),
    records: Array.isArray(state.records) ? state.records.map(publicKeyRecord).filter(Boolean) : [],
    permissions: Array.isArray(state.permissions)
      ? state.permissions.map((permission) => ({
          keyHash: text(permission.keyHash),
          capabilityHash: text(permission.capabilityHash),
          status: normalizeStatus(permission.status),
          createdAt: permission.createdAt || nowIso()
        })).filter((permission) => permission.keyHash && permission.capabilityHash)
      : [],
    events: Array.isArray(state.events) ? state.events.slice(-2048).map((event) => asObject(event)) : [],
    createdAt: state.createdAt || nowIso(),
    updatedAt: state.updatedAt || nowIso(),
    stateRoot: text(state.stateRoot)
  };
  if (!normalized.runtimeLookupKeyBase64 || Buffer.from(normalized.runtimeLookupKeyBase64, "base64").length < 32) {
    normalized.runtimeLookupKeyBase64 = randomBase64(32);
  }
  normalized.stateRoot = kernelStateRoot(normalized);
  return normalized;
}

function isoTime(value = "") {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function earlierIso(a = "", b = "") {
  const aTime = isoTime(a);
  const bTime = isoTime(b);
  if (!aTime) {
    return b || "";
  }
  if (!bTime) {
    return a || "";
  }
  return aTime <= bTime ? a : b;
}

function laterIso(a = "", b = "") {
  const aTime = isoTime(a);
  const bTime = isoTime(b);
  if (!aTime) {
    return b || "";
  }
  if (!bTime) {
    return a || "";
  }
  return aTime >= bTime ? a : b;
}

function mergeKeyRecord(existing = null, candidate = null) {
  const current = publicKeyRecord(existing);
  const next = publicKeyRecord(candidate);
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  if (current.status !== "valid" || next.status !== "valid") {
    const invalid = current.status !== "valid" ? current : next;
    const other = current.status !== "valid" ? next : current;
    return publicKeyRecord({
      ...other,
      ...invalid,
      status: "invalid",
      invalidatedAt: laterIso(current.invalidatedAt, next.invalidatedAt),
      invalidationReason: invalid.invalidationReason || other.invalidationReason,
      createdAt: earlierIso(current.createdAt, next.createdAt),
      updatedAt: laterIso(current.updatedAt, next.updatedAt)
    });
  }
  return isoTime(next.updatedAt || next.createdAt) >= isoTime(current.updatedAt || current.createdAt)
    ? next
    : current;
}

function mergePermissionRecord(existing = null, candidate = null) {
  if (!existing) {
    return candidate;
  }
  if (!candidate) {
    return existing;
  }
  const status = existing.status !== "valid" || candidate.status !== "valid" ? "invalid" : "valid";
  return {
    ...existing,
    ...candidate,
    status,
    createdAt: earlierIso(existing.createdAt, candidate.createdAt)
  };
}

function mergeKernelStates(persistedInput = {}, hotInput = {}) {
  const persisted = normalizeKernelState(persistedInput);
  const hot = normalizeKernelState(hotInput);
  if (persisted.runtimeLookupKeyBase64 !== hot.runtimeLookupKeyBase64) {
    return persisted;
  }
  const records = new Map();
  for (const record of persisted.records) {
    records.set(record.keyHash, mergeKeyRecord(records.get(record.keyHash), record));
  }
  for (const record of hot.records) {
    records.set(record.keyHash, mergeKeyRecord(records.get(record.keyHash), record));
  }
  const permissions = new Map();
  for (const permission of persisted.permissions) {
    const key = `${permission.keyHash}:${permission.capabilityHash}`;
    permissions.set(key, mergePermissionRecord(permissions.get(key), permission));
  }
  for (const permission of hot.permissions) {
    const key = `${permission.keyHash}:${permission.capabilityHash}`;
    permissions.set(key, mergePermissionRecord(permissions.get(key), permission));
  }
  const eventsById = new Map();
  for (const event of [...persisted.events, ...hot.events]) {
    const normalized = asObject(event);
    const key = text(normalized.eventId) || opaqueCapabilityHash([stableJson(normalized)]);
    eventsById.set(key, normalized);
  }
  return normalizeKernelState({
    ...persisted,
    epoch: Math.max(Number(persisted.epoch || 1), Number(hot.epoch || 1)),
    records: [...records.values()],
    permissions: [...permissions.values()],
    events: [...eventsById.values()].slice(-2048),
    createdAt: earlierIso(persisted.createdAt, hot.createdAt),
    updatedAt: laterIso(persisted.updatedAt, hot.updatedAt)
  });
}

function kernelStateRoot(state = {}) {
  const normalized = {
    stateVersion: Number(state.stateVersion || KERNEL_STATE_VERSION),
    provider: text(state.provider),
    securityMode: text(state.securityMode),
    epoch: Number(state.epoch || 1),
    runtimeLookupKeyHash: hashBase64Url(text(state.runtimeLookupKeyBase64)),
    records: Array.isArray(state.records) ? state.records.map(publicKeyRecord).sort((a, b) => a.keyHash.localeCompare(b.keyHash)) : [],
    permissions: Array.isArray(state.permissions)
      ? state.permissions.map((permission) => ({
          keyHash: text(permission.keyHash),
          capabilityHash: text(permission.capabilityHash),
          status: normalizeStatus(permission.status)
        })).sort((a, b) => `${a.keyHash}:${a.capabilityHash}`.localeCompare(`${b.keyHash}:${b.capabilityHash}`))
      : []
  };
  return crypto.createHash("sha256").update(stableJson(normalized), "utf8").digest("base64url");
}

function sealJson({ sealingKeyBase64 = "", payload = {} } = {}) {
  const key = Buffer.from(text(sealingKeyBase64), "base64");
  if (key.length < 32) {
    throw new Error("Capability kernel state sealing key must be at least 256 bits.");
  }
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(AEAD_ALGORITHM, key.subarray(0, 32), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(stableJson(payload), "utf8"),
    cipher.final()
  ]);
  return {
    algorithm: AEAD_ALGORITHM,
    nonceBase64: nonce.toString("base64"),
    ciphertextBase64: ciphertext.toString("base64"),
    tagBase64: cipher.getAuthTag().toString("base64")
  };
}

function openSealedJson({ sealingKeyBase64 = "", sealed = null } = {}) {
  const key = Buffer.from(text(sealingKeyBase64), "base64");
  if (key.length < 32) {
    throw new Error("Capability kernel state sealing key must be at least 256 bits.");
  }
  const sealedObject = asObject(sealed, null);
  if (!sealedObject || sealedObject.algorithm !== AEAD_ALGORITHM) {
    throw new Error("Unsupported capability kernel sealed state payload.");
  }
  const decipher = crypto.createDecipheriv(
    AEAD_ALGORITHM,
    key.subarray(0, 32),
    Buffer.from(text(sealedObject.nonceBase64), "base64")
  );
  decipher.setAuthTag(Buffer.from(text(sealedObject.tagBase64), "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(text(sealedObject.ciphertextBase64), "base64")),
    decipher.final()
  ]).toString("utf8");
  return parseJson(plaintext, {});
}

function publicKernelRecord(record = {}) {
  return {
    protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
    alias: safeAlias(record.alias || DEFAULT_ALIAS),
    provider: text(record.provider || "local-file"),
    securityMode: text(record.securityMode || "degraded_file_fallback"),
    generation: Number(record.generation || 1),
    stateRoot: text(record.stateRoot),
    createdAt: record.createdAt || "",
    updatedAt: record.updatedAt || ""
  };
}

function createKernelRecord({ alias = DEFAULT_ALIAS, provider = "local-file", securityMode = "degraded_file_fallback", state = null, sealingKeyBase64 = "" } = {}) {
  const timestamp = nowIso();
  const normalizedState = normalizeKernelState(state || createEmptyKernelState({ provider, securityMode }));
  const sealingKey = sealingKeyBase64 || randomBase64(32);
  return {
    protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
    alias: safeAlias(alias),
    provider,
    securityMode,
    generation: Number(normalizedState.epoch || 1),
    sealingKeyBase64: sealingKey,
    sealedState: sealJson({ sealingKeyBase64: sealingKey, payload: normalizedState }),
    stateRoot: normalizedState.stateRoot,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function isClosedPipeError(error) {
  return error?.code === "EPIPE" || error?.code === "ECONNRESET";
}

function markNeedsInitialWrite(record) {
  Object.defineProperty(record, "__needsInitialWrite", {
    value: true,
    enumerable: false,
    configurable: true,
    writable: true
  });
  return record;
}

async function runText(command, args = [], { input = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.stdin.on("error", (error) => {
      if (isClosedPipeError(error)) {
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${command} failed with exit code ${code}`));
        return;
      }
      resolve(stdout);
    });
    try {
      child.stdin.end(input);
    } catch (error) {
      if (!isClosedPipeError(error)) {
        reject(error);
      }
    }
  });
}

function commandExists(command) {
  const pathEnv = String(process.env.PATH || "");
  return pathEnv.split(path.delimiter).some((dir) => {
    try {
      fs.accessSync(path.join(dir, command), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function detectLinuxCapabilityKernelBackends() {
  if (process.platform !== "linux") {
    return [];
  }
  const detected = [];
  if (commandExists("systemd-creds") || commandExists("systemd-cryptenroll")) {
    detected.push("systemd-credentials");
  }
  if (commandExists("keyctl")) {
    detected.push("linux-kernel-keyring");
  }
  if (commandExists("secret-tool")) {
    detected.push("secret-service");
  }
  if (commandExists("pass")) {
    detected.push("pass-gpg");
  }
  detected.push("local-file");
  return detected;
}

function linuxCapabilityKernelBackendCandidates() {
  if (process.platform !== "linux") {
    return [];
  }
  const candidates = [];
  if (commandExists("keyctl")) {
    candidates.push("linux-kernel-keyring");
  }
  if (commandExists("secret-tool")) {
    candidates.push("secret-service");
  }
  if (commandExists("pass")) {
    candidates.push("pass-gpg");
  }
  candidates.push("local-file");
  return candidates;
}

function firstUsableLinuxCapabilityKernelBackend() {
  return linuxCapabilityKernelBackendCandidates()[0] || "local-file";
}

function resolveAutoCapabilityKernelBackend(backend = "auto") {
  if (backend !== "auto") {
    return backend;
  }
  if (process.platform === "darwin") {
    return "macos-keychain";
  }
  if (process.platform === "linux") {
    return firstUsableLinuxCapabilityKernelBackend();
  }
  if (process.platform === "win32") {
    return commandExists("powershell.exe") || commandExists("pwsh") ? "windows-dpapi" : "local-file";
  }
  return "local-file";
}

function windowsDpapiCommand() {
  if (process.env.PACT_WINDOWS_DPAPI_COMMAND) {
    return process.env.PACT_WINDOWS_DPAPI_COMMAND;
  }
  if (commandExists("powershell.exe")) {
    return "powershell.exe";
  }
  if (commandExists("pwsh")) {
    return "pwsh";
  }
  return "";
}

function windowsDpapiProtectedPath({ dataDir = "", alias = DEFAULT_ALIAS } = {}) {
  return path.join(resolveDataDir(dataDir), "security", "capability-kernel", `${safeAlias(alias)}.dpapi`);
}

async function runWindowsDpapi({ action = "protect", input = "" } = {}) {
  const command = windowsDpapiCommand();
  if (!command) {
    throw new Error("Windows DPAPI backend requires powershell.exe or pwsh.");
  }
  const protectScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$plain = [Console]::In.ReadToEnd()
$bytes = [System.Text.Encoding]::UTF8.GetBytes($plain)
$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($protected))
`;
  const unprotectScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$cipher = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($cipher)
$plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plainBytes))
`;
  return runText(command, [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    action === "unprotect" ? unprotectScript : protectScript
  ], { input });
}

function linuxKeyringDescription(alias = DEFAULT_ALIAS) {
  return `pact:capability-kernel:${safeAlias(alias)}`;
}

function secretToolAttributes(alias = DEFAULT_ALIAS) {
  return [
    "application",
    "pact",
    "component",
    "capability-kernel",
    "alias",
    safeAlias(alias)
  ];
}

function passEntryName(alias = DEFAULT_ALIAS) {
  return `pact/capability-kernel/${safeAlias(alias)}`;
}

async function readLocalKernelRecord({ dataDir = "", alias = DEFAULT_ALIAS, provider = "local-file", securityMode = "degraded_file_fallback" } = {}) {
  const filePath = capabilityKernelStatePath({ dataDir, alias });
  try {
    const record = parseJson(await fs.promises.readFile(filePath, "utf8"), null);
    if (record && !record.sealingKeyBase64) {
      record.sealingKeyBase64 = text(await fs.promises.readFile(
        capabilityKernelLocalSealingKeyPath({ dataDir, alias }),
        "utf8"
      ));
    }
    return record;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return markNeedsInitialWrite(createKernelRecord({ alias, provider, securityMode }));
    }
    throw error;
  }
}

async function writeLocalKernelRecord({ dataDir = "", alias = DEFAULT_ALIAS } = {}, record = {}) {
  const filePath = capabilityKernelStatePath({ dataDir, alias });
  const sealingKey = text(record.sealingKeyBase64);
  if (!sealingKey) {
    throw new Error("Local capability kernel fallback requires a sealing key sidecar.");
  }
  await writePrivateFileAtomic(capabilityKernelLocalSealingKeyPath({ dataDir, alias }), `${sealingKey}\n`);
  const { sealingKeyBase64, ...persistedRecord } = record;
  void sealingKeyBase64;
  await writePrivateFileAtomic(filePath, `${JSON.stringify(persistedRecord, null, 2)}\n`);
  return record;
}

async function readMacosKernelRecord({ alias = DEFAULT_ALIAS } = {}) {
  if (process.platform !== "darwin") {
    throw new Error("macos-keychain capability kernel backend is only available on macOS.");
  }
  try {
    const raw = await runText("/usr/bin/security", [
      "find-generic-password",
      "-w",
      "-a",
      "pact",
      "-s",
      keychainService(alias)
    ]);
    return parseJson(raw.trim(), null);
  } catch (error) {
    if (/could not be found|The specified item could not be found/i.test(error.message)) {
      return markNeedsInitialWrite(createKernelRecord({ alias, provider: "macos-keychain", securityMode: "keyring" }));
    }
    throw error;
  }
}

async function writeMacosKernelRecord({ alias = DEFAULT_ALIAS } = {}, record = {}) {
  if (process.platform !== "darwin") {
    throw new Error("macos-keychain capability kernel backend is only available on macOS.");
  }
  await runText("/usr/bin/security", [
    "add-generic-password",
    "-U",
    "-a",
    "pact",
    "-s",
    keychainService(alias),
    "-w",
    JSON.stringify(record)
  ]);
  return record;
}

async function readLinuxKernelKeyringRecord({ alias = DEFAULT_ALIAS } = {}) {
  const description = linuxKeyringDescription(alias);
  let serial = "";
  try {
    serial = (await runText("keyctl", ["search", "@u", "user", description])).trim();
  } catch (error) {
    if (/not found|cannot find|requested key not available|key has been revoked/i.test(error.message)) {
      return markNeedsInitialWrite(createKernelRecord({ alias, provider: "linux-kernel-keyring", securityMode: "keyring" }));
    }
    throw error;
  }
  if (!serial) {
    return markNeedsInitialWrite(createKernelRecord({ alias, provider: "linux-kernel-keyring", securityMode: "keyring" }));
  }
  const raw = await runText("keyctl", ["pipe", serial]);
  return parseJson(raw.trim(), null);
}

async function writeLinuxKernelKeyringRecord({ alias = DEFAULT_ALIAS } = {}, record = {}) {
  const description = linuxKeyringDescription(alias);
  try {
    const serial = (await runText("keyctl", ["search", "@u", "user", description])).trim();
    if (serial) {
      await runText("keyctl", ["unlink", serial, "@u"]).catch(() => {});
    }
  } catch {
    // Missing existing key is expected on first write.
  }
  await runText("keyctl", ["padd", "user", description, "@u"], { input: JSON.stringify(record) });
  return record;
}

async function readSecretServiceKernelRecord({ alias = DEFAULT_ALIAS } = {}) {
  try {
    const raw = await runText("secret-tool", ["lookup", ...secretToolAttributes(alias)]);
    return parseJson(raw.trim(), null);
  } catch (error) {
    if (/no such object|not found|couldn't find|cannot autolaunch/i.test(error.message)) {
      return markNeedsInitialWrite(createKernelRecord({ alias, provider: "secret-service", securityMode: "keyring" }));
    }
    throw error;
  }
}

async function writeSecretServiceKernelRecord({ alias = DEFAULT_ALIAS } = {}, record = {}) {
  await runText("secret-tool", [
    "store",
    "--label",
    `Pact Capability Kernel ${safeAlias(alias)}`,
    ...secretToolAttributes(alias)
  ], { input: JSON.stringify(record) });
  return record;
}

async function readPassKernelRecord({ alias = DEFAULT_ALIAS } = {}) {
  try {
    const raw = await runText("pass", ["show", passEntryName(alias)]);
    return parseJson(raw.trim(), null);
  } catch (error) {
    if (/not in the password store|is not in the password store|No such file|not found/i.test(error.message)) {
      return markNeedsInitialWrite(createKernelRecord({ alias, provider: "pass-gpg", securityMode: "user_keyring" }));
    }
    throw error;
  }
}

async function writePassKernelRecord({ alias = DEFAULT_ALIAS } = {}, record = {}) {
  await runText("pass", ["insert", "-m", "-f", passEntryName(alias)], { input: JSON.stringify(record) });
  return record;
}

async function readWindowsDpapiKernelRecord({ dataDir = "", alias = DEFAULT_ALIAS } = {}) {
  const filePath = windowsDpapiProtectedPath({ dataDir, alias });
  try {
    const protectedPayload = await fs.promises.readFile(filePath, "utf8");
    const raw = await runWindowsDpapi({ action: "unprotect", input: protectedPayload });
    return parseJson(raw.trim(), null);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return markNeedsInitialWrite(createKernelRecord({ alias, provider: "windows-dpapi", securityMode: "dpapi" }));
    }
    throw error;
  }
}

async function writeWindowsDpapiKernelRecord({ dataDir = "", alias = DEFAULT_ALIAS } = {}, record = {}) {
  const filePath = windowsDpapiProtectedPath({ dataDir, alias });
  const protectedPayload = await runWindowsDpapi({ action: "protect", input: JSON.stringify(record) });
  await writePrivateFileAtomic(filePath, protectedPayload);
  return record;
}

function degradedLocalKernelRecord(record = {}, { alias = DEFAULT_ALIAS } = {}) {
  const state = stateFromKernelRecord(record);
  return {
    ...createKernelRecord({
      alias,
      provider: "local-file",
      securityMode: "degraded_file_fallback",
      state: {
        ...state,
        provider: "local-file",
        securityMode: "degraded_file_fallback"
      },
      sealingKeyBase64: record.sealingKeyBase64
    }),
    createdAt: record.createdAt || nowIso()
  };
}

function capabilityKernelSecurityModeForProvider(provider = "") {
  if (provider === "linux-kernel-keyring" || provider === "secret-service" || provider === "macos-keychain") {
    return "keyring";
  }
  if (provider === "pass-gpg") {
    return "user_keyring";
  }
  if (provider === "windows-dpapi") {
    return "dpapi";
  }
  return "degraded_file_fallback";
}

function rewrapKernelRecordForProvider(record = {}, { alias = DEFAULT_ALIAS, provider = "local-file" } = {}) {
  if (provider === "local-file") {
    return degradedLocalKernelRecord(record, { alias });
  }
  const securityMode = capabilityKernelSecurityModeForProvider(provider);
  const state = stateFromKernelRecord(record);
  return {
    ...createKernelRecord({
      alias,
      provider,
      securityMode,
      state: {
        ...state,
        provider,
        securityMode
      },
      sealingKeyBase64: record.sealingKeyBase64
    }),
    createdAt: record.createdAt || nowIso()
  };
}

async function readLinuxAutoKernelRecord({ dataDir = "", alias = DEFAULT_ALIAS } = {}) {
  for (const candidate of linuxCapabilityKernelBackendCandidates()) {
    try {
      if (candidate === "linux-kernel-keyring") {
        return await readLinuxKernelKeyringRecord({ alias });
      }
      if (candidate === "secret-service") {
        return await readSecretServiceKernelRecord({ alias });
      }
      if (candidate === "pass-gpg") {
        return await readPassKernelRecord({ alias });
      }
      return await readLocalKernelRecord({
        dataDir,
        alias,
        provider: "local-file",
        securityMode: "degraded_file_fallback"
      });
    } catch {
      // Auto mode keeps scanning lower-priority Linux backends before file fallback.
    }
  }
  return readLocalKernelRecord({
    dataDir,
    alias,
    provider: "local-file",
    securityMode: "degraded_file_fallback"
  });
}

async function writeLinuxAutoKernelRecord({ dataDir = "", alias = DEFAULT_ALIAS } = {}, record = {}) {
  const candidates = linuxCapabilityKernelBackendCandidates();
  const startIndex = Math.max(0, candidates.indexOf(record.provider));
  const orderedCandidates = candidates.slice(startIndex);
  let lastError = null;
  for (const candidate of orderedCandidates) {
    const candidateRecord = candidate === record.provider
      ? record
      : rewrapKernelRecordForProvider(record, { alias, provider: candidate });
    try {
      if (candidate === "linux-kernel-keyring") {
        return await writeLinuxKernelKeyringRecord({ alias }, candidateRecord);
      }
      if (candidate === "secret-service") {
        return await writeSecretServiceKernelRecord({ alias }, candidateRecord);
      }
      if (candidate === "pass-gpg") {
        return await writePassKernelRecord({ alias }, candidateRecord);
      }
      return await writeLocalKernelRecord({ dataDir, alias }, candidateRecord);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    throw lastError;
  }
  return writeLocalKernelRecord({ dataDir, alias }, degradedLocalKernelRecord(record, { alias }));
}

async function readKernelRecord({ backend = "auto", dataDir = "", alias = DEFAULT_ALIAS } = {}) {
  if ((backend === "auto" || backend === "macos-keychain") && process.platform === "darwin") {
    try {
      return await readMacosKernelRecord({ alias });
    } catch (error) {
      if (backend === "macos-keychain") {
        throw error;
      }
    }
  }
  if (backend === "auto" && process.platform === "linux") {
    return readLinuxAutoKernelRecord({ dataDir, alias });
  }
  const resolvedBackend = resolveAutoCapabilityKernelBackend(backend);
  if (resolvedBackend === "linux-kernel-keyring") {
    try {
      return await readLinuxKernelKeyringRecord({ alias });
    } catch (error) {
      if (backend !== "auto") {
        throw error;
      }
    }
  }
  if (resolvedBackend === "secret-service") {
    try {
      return await readSecretServiceKernelRecord({ alias });
    } catch (error) {
      if (backend !== "auto") {
        throw error;
      }
    }
  }
  if (resolvedBackend === "pass-gpg") {
    try {
      return await readPassKernelRecord({ alias });
    } catch (error) {
      if (backend !== "auto") {
        throw error;
      }
    }
  }
  if (resolvedBackend === "windows-dpapi") {
    try {
      return await readWindowsDpapiKernelRecord({ dataDir, alias });
    } catch (error) {
      if (backend !== "auto") {
        throw error;
      }
    }
  }
  return readLocalKernelRecord({
    dataDir,
    alias,
    provider: backend === "auto" ? "local-file" : backend,
    securityMode: "degraded_file_fallback"
  });
}

async function writeKernelRecord({ backend = "auto", dataDir = "", alias = DEFAULT_ALIAS } = {}, record = {}) {
  if (backend === "auto" && process.platform === "linux") {
    return writeLinuxAutoKernelRecord({ dataDir, alias }, record);
  }
  if (record.provider === "macos-keychain" && process.platform === "darwin") {
    try {
      return await writeMacosKernelRecord({ alias }, record);
    } catch (error) {
      if (backend !== "auto") {
        throw error;
      }
      return writeLocalKernelRecord({ dataDir, alias }, degradedLocalKernelRecord(record, { alias }));
    }
  }
  if (record.provider === "linux-kernel-keyring") {
    try {
      return await writeLinuxKernelKeyringRecord({ alias }, record);
    } catch (error) {
      if (backend !== "auto") {
        throw error;
      }
      return writeLocalKernelRecord({ dataDir, alias }, degradedLocalKernelRecord(record, { alias }));
    }
  }
  if (record.provider === "secret-service") {
    try {
      return await writeSecretServiceKernelRecord({ alias }, record);
    } catch (error) {
      if (backend !== "auto") {
        throw error;
      }
      return writeLocalKernelRecord({ dataDir, alias }, degradedLocalKernelRecord(record, { alias }));
    }
  }
  if (record.provider === "pass-gpg") {
    try {
      return await writePassKernelRecord({ alias }, record);
    } catch (error) {
      if (backend !== "auto") {
        throw error;
      }
      return writeLocalKernelRecord({ dataDir, alias }, degradedLocalKernelRecord(record, { alias }));
    }
  }
  if (record.provider === "windows-dpapi") {
    try {
      return await writeWindowsDpapiKernelRecord({ dataDir, alias }, record);
    } catch (error) {
      if (backend !== "auto") {
        throw error;
      }
      return writeLocalKernelRecord({ dataDir, alias }, degradedLocalKernelRecord(record, { alias }));
    }
  }
  return writeLocalKernelRecord({ dataDir, alias }, {
    ...record,
    provider: record.provider || (backend === "auto" ? "local-file" : backend),
    securityMode: record.securityMode || "degraded_file_fallback"
  });
}

function stateFromKernelRecord(record = {}) {
  const opened = openSealedJson({
    sealingKeyBase64: record.sealingKeyBase64,
    sealed: record.sealedState
  });
  const state = normalizeKernelState({
    ...opened,
    provider: record.provider,
    securityMode: record.securityMode
  });
  if (record.stateRoot && state.stateRoot !== record.stateRoot) {
    throw new Error("Capability kernel sealed state root mismatch.");
  }
  return state;
}

export function createMemoryCapabilityKeyBindingStore() {
  const records = new Map();
  const permissions = new Map();

  function put(record, capabilityHashes = []) {
    const normalized = publicKeyRecord(record);
    records.set(normalized.keyHash, normalized);
    for (const capabilityHash of capabilityHashes) {
      permissions.set(`${normalized.keyHash}:${capabilityHash}`, {
        keyHash: normalized.keyHash,
        capabilityHash,
        status: normalized.status,
        createdAt: nowIso()
      });
    }
    return normalized;
  }

  function get(keyHash = "") {
    return publicKeyRecord(records.get(String(keyHash || "")) || null);
  }

  function hasCapability(keyHash = "", capabilityHashes = []) {
    return capabilityHashes.some((capabilityHash) => permissions.get(`${keyHash}:${capabilityHash}`)?.status === "valid");
  }

  function invalidate(keyHash = "", reason = "") {
    const existing = get(keyHash);
    if (!existing) {
      return null;
    }
    const updated = publicKeyRecord({
      ...existing,
      status: "invalid",
      invalidatedAt: nowIso(),
      invalidationReason: text(reason),
      updatedAt: nowIso()
    });
    records.set(updated.keyHash, updated);
    for (const [permissionKey, permission] of permissions.entries()) {
      if (permission.keyHash === updated.keyHash) {
        permissions.set(permissionKey, { ...permission, status: "invalid" });
      }
    }
    return updated;
  }

  function list({ includeInvalid = false } = {}) {
    const values = [...records.values()].map(publicKeyRecord);
    return includeInvalid ? values : values.filter((record) => record.status === "valid");
  }

  return Object.freeze({
    put,
    get,
    hasCapability,
    invalidate,
    list,
    close() {}
  });
}

export function createSealedCapabilityKernelStore({
  backend = "auto",
  dataDir = "",
  alias = DEFAULT_ALIAS
} = {}) {
  let loaded = false;
  let record = null;
  let state = null;
  let loadCount = 0;
  let saveCount = 0;
  let loadPromise = null;
  let mutationQueue = Promise.resolve();

  function enqueueMutation(action) {
    const run = mutationQueue.catch(() => {}).then(async () => withPrivateFileLock(
      capabilityKernelLockPath({ dataDir, alias }),
      async () => {
        const hotState = loaded && state ? state : null;
        if (loadPromise) {
          await loadPromise.catch(() => {});
        }
        loaded = false;
        state = null;
        loadPromise = null;
        if (hotState) {
          await load();
          state = mergeKernelStates(state, hotState);
          record = {
            ...record,
            generation: Number(state.epoch || record?.generation || 1),
            stateRoot: state.stateRoot,
            updatedAt: laterIso(record?.updatedAt, state.updatedAt)
          };
          loaded = true;
        }
        return action();
      }
    ));
    mutationQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function waitForMutations() {
    await mutationQueue.catch(() => {});
  }

  async function load() {
    if (loaded) {
      return state;
    }
    if (!loadPromise) {
      loadPromise = (async () => {
        record = await readKernelRecord({ backend, dataDir, alias });
        record.alias = safeAlias(alias);
        if (!record.sealingKeyBase64 || !record.sealedState) {
          record = createKernelRecord({
            alias,
            provider: record.provider || (backend === "auto" && process.platform === "darwin" ? "macos-keychain" : "local-file"),
            securityMode: record.securityMode || (record.provider === "macos-keychain" ? "keyring" : "degraded_file_fallback")
          });
          record = await writeKernelRecord({ backend, dataDir, alias }, record);
        }
        state = stateFromKernelRecord(record);
        loaded = true;
        loadCount += 1;
        return state;
      })().finally(() => {
        loadPromise = null;
      });
    }
    return loadPromise;
  }

  async function save(event = {}) {
    await load();
    const timestamp = nowIso();
    const nextEvent = {
      eventId: `cap_event_${crypto.randomUUID()}`,
      at: timestamp,
      ...asObject(event)
    };
    state = normalizeKernelState({
      ...state,
      epoch: Number(state.epoch || 1) + 1,
      updatedAt: timestamp,
      events: [...(Array.isArray(state.events) ? state.events : []), nextEvent].slice(-2048)
    });
    record = {
      ...record,
      generation: state.epoch,
      sealedState: sealJson({ sealingKeyBase64: record.sealingKeyBase64, payload: state }),
      stateRoot: state.stateRoot,
      updatedAt: timestamp
    };
    record = await writeKernelRecord({ backend, dataDir, alias }, record);
    saveCount += 1;
    return state;
  }

  async function put(inputRecord, capabilityHashes = []) {
    return enqueueMutation(async () => {
      await load();
      const normalized = publicKeyRecord(inputRecord);
      const records = new Map(state.records.map((item) => [item.keyHash, item]));
      records.set(normalized.keyHash, normalized);
      const permissions = new Map(state.permissions.map((item) => [`${item.keyHash}:${item.capabilityHash}`, item]));
      for (const capabilityHash of capabilityHashes) {
        permissions.set(`${normalized.keyHash}:${capabilityHash}`, {
          keyHash: normalized.keyHash,
          capabilityHash,
          status: normalized.status,
          createdAt: nowIso()
        });
      }
      state = {
        ...state,
        records: [...records.values()].map(publicKeyRecord),
        permissions: [...permissions.values()]
      };
      await save({ action: "put", keyHash: normalized.keyHash, capabilityHashCount: capabilityHashes.length });
      return normalized;
    });
  }

  async function get(keyHash = "") {
    await waitForMutations();
    await load();
    return publicKeyRecord(state.records.find((item) => item.keyHash === String(keyHash || "")) || null);
  }

  async function hasCapability(keyHash = "", capabilityHashes = []) {
    await waitForMutations();
    await load();
    if (capabilityHashes.length === 0) {
      return true;
    }
    const wanted = new Set(capabilityHashes);
    return state.permissions.some((permission) => (
      permission.keyHash === String(keyHash || "") &&
      permission.status === "valid" &&
      wanted.has(permission.capabilityHash)
    ));
  }

  async function invalidate(keyHash = "", reason = "") {
    return enqueueMutation(async () => {
      await load();
      const existing = publicKeyRecord(state.records.find((item) => item.keyHash === String(keyHash || "")) || null);
      if (!existing) {
        return null;
      }
      const updated = publicKeyRecord({
        ...existing,
        status: "invalid",
        invalidatedAt: nowIso(),
        invalidationReason: text(reason),
        updatedAt: nowIso()
      });
      state = {
        ...state,
        records: state.records.map((item) => item.keyHash === updated.keyHash ? updated : item),
        permissions: state.permissions.map((permission) => (
          permission.keyHash === updated.keyHash ? { ...permission, status: "invalid" } : permission
        ))
      };
      await save({ action: "invalidate", keyHash: updated.keyHash, reason: text(reason) });
      return updated;
    });
  }

  async function list({ includeInvalid = false } = {}) {
    await waitForMutations();
    await load();
    const values = state.records.map(publicKeyRecord);
    return includeInvalid ? values : values.filter((item) => item.status === "valid");
  }

  async function loadRuntimeLookupKeyUnlocked() {
    await load();
    if (record.__needsInitialWrite === true) {
      record.__needsInitialWrite = false;
      await save({ action: "initialize_runtime_lookup_key" });
    }
    return {
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      provider: record.provider,
      securityMode: record.securityMode,
      alias: record.alias,
      generation: Number(state.epoch || record.generation || 1),
      runtimeLookupKeyBase64: state.runtimeLookupKeyBase64
    };
  }

  async function loadRuntimeLookupKey() {
    if (!loaded || record?.__needsInitialWrite === true) {
      return enqueueMutation(loadRuntimeLookupKeyUnlocked);
    }
    await waitForMutations();
    return loadRuntimeLookupKeyUnlocked();
  }

  async function rotateRuntimeLookupKey() {
    return enqueueMutation(async () => {
      await load();
      if (state.records.length > 0 || state.permissions.length > 0) {
        throw new Error("Runtime lookup key rotation is only allowed before capability bindings exist; rotate opaque capability keys instead.");
      }
      state = {
        ...state,
        runtimeLookupKeyBase64: randomBase64(32)
      };
      await save({ action: "rotate_runtime_lookup_key" });
      return publicKernelRecord(record);
    });
  }

  function recoveryKeyFromPassphrase(passphrase = "", saltBase64 = "") {
    const passphraseText = text(passphrase);
    if (!passphraseText) {
      throw new Error("Capability kernel recovery export requires a passphrase.");
    }
    return crypto.scryptSync(passphraseText, Buffer.from(saltBase64, "base64"), 32).toString("base64");
  }

  async function exportRecoveryPackage({ passphrase = "", reason = "" } = {}) {
    await waitForMutations();
    await load();
    const saltBase64 = randomBase64(16);
    const recoveryKeyBase64 = recoveryKeyFromPassphrase(passphrase, saltBase64);
    const packagePayload = {
      protocolVersion: RECOVERY_PACKAGE_VERSION,
      alias: safeAlias(alias),
      exportedAt: nowIso(),
      reason: text(reason),
      provider: record.provider,
      securityMode: record.securityMode,
      state
    };
    return {
      protocolVersion: RECOVERY_PACKAGE_VERSION,
      alias: safeAlias(alias),
      exportedAt: packagePayload.exportedAt,
      stateRoot: state.stateRoot,
      epoch: state.epoch,
      kdf: {
        name: "scrypt",
        saltBase64
      },
      sealedRecovery: sealJson({ sealingKeyBase64: recoveryKeyBase64, payload: packagePayload })
    };
  }

  async function importRecoveryPackage({ recoveryPackage = null, passphrase = "" } = {}) {
    return enqueueMutation(async () => {
      const packageObject = asObject(recoveryPackage, null);
      if (!packageObject || packageObject.protocolVersion !== RECOVERY_PACKAGE_VERSION) {
        throw new Error("Unsupported capability kernel recovery package.");
      }
      const saltBase64 = text(packageObject.kdf?.saltBase64);
      const recoveryKeyBase64 = recoveryKeyFromPassphrase(passphrase, saltBase64);
      const opened = openSealedJson({
        sealingKeyBase64: recoveryKeyBase64,
        sealed: packageObject.sealedRecovery
      });
      const importedState = normalizeKernelState(asObject(opened.state));
      const targetProvider = record?.provider || (backend === "auto" && process.platform === "darwin" ? "macos-keychain" : "local-file");
      const targetSecurityMode = record?.securityMode || (targetProvider === "macos-keychain" ? "keyring" : "degraded_file_fallback");
      state = {
        ...importedState,
        provider: targetProvider,
        securityMode: targetSecurityMode
      };
      record = record || createKernelRecord({ alias, provider: state.provider, securityMode: state.securityMode, state });
      record = {
        ...record,
        generation: Number(state.epoch || 1),
        sealedState: sealJson({ sealingKeyBase64: record.sealingKeyBase64, payload: state }),
        stateRoot: state.stateRoot,
        updatedAt: nowIso()
      };
      loaded = true;
      record = await writeKernelRecord({ backend, dataDir, alias }, record);
      saveCount += 1;
      return {
        ok: true,
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        alias: safeAlias(alias),
        epoch: state.epoch,
        stateRoot: state.stateRoot,
        provider: record.provider,
        securityMode: record.securityMode
      };
    });
  }

  async function describe() {
    await waitForMutations();
    await load();
    return {
      ...publicKernelRecord(record),
      loadCount,
      saveCount,
      bindingCount: state.records.length,
      permissionBindingCount: state.permissions.length,
      runtimeLookupKeyRotationSupported: state.records.length === 0 && state.permissions.length === 0,
      linuxDetectedBackends: detectLinuxCapabilityKernelBackends()
    };
  }

  return Object.freeze({
    put,
    get,
    hasCapability,
    invalidate,
    list,
    close() {},
    keySource: {
      loadRuntimeLookupKey,
      rotateRuntimeLookupKey,
      describe
    },
    exportRecoveryPackage,
    importRecoveryPackage,
    describe
  });
}

function runCommandJson({ command, args = [], env = {}, input = {}, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env }
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Opaque capability key helper timed out: ${command}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.stdin.on("error", (error) => {
      if (isClosedPipeError(error)) {
        return;
      }
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Opaque capability key helper failed with exit code ${code}.`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim() || "{}"));
      } catch (error) {
        reject(new Error(`Opaque capability key helper returned invalid JSON: ${error.message}`));
      }
    });
    try {
      child.stdin.end(`${JSON.stringify(input)}\n`);
    } catch (error) {
      if (!isClosedPipeError(error)) {
        clearTimeout(timeout);
        reject(error);
      }
    }
  });
}

function createMemoryLookupKeySource() {
  let generation = 1;
  let runtimeLookupKeyBase64 = crypto.randomBytes(32).toString("base64");
  let loadCount = 0;
  return {
    async loadRuntimeLookupKey() {
      loadCount += 1;
      return {
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        provider: "memory",
        generation,
        runtimeLookupKeyBase64
      };
    },
    async rotateRuntimeLookupKey() {
      generation += 1;
      runtimeLookupKeyBase64 = crypto.randomBytes(32).toString("base64");
      return {
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        provider: "memory",
        generation
      };
    },
    describe() {
      return {
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        provider: "memory",
        generation,
        loadCount
      };
    }
  };
}

function createCommandLookupKeySource({
  alias = DEFAULT_ALIAS,
  backend = process.platform === "darwin" ? "macos-keychain" : "local-file",
  dataDir = "",
  command = process.execPath,
  args = [helperScriptPath()],
  env = {},
  timeoutMs = 15000
} = {}) {
  async function request(action, input = {}) {
    return runCommandJson({
      command,
      args,
      env,
      timeoutMs,
      input: {
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        action,
        backend,
        alias,
        dataDir,
        ...input
      }
    });
  }
  return {
    loadRuntimeLookupKey: () => request("loadRuntimeLookupKey"),
    rotateRuntimeLookupKey: () => request("rotateRuntimeLookupKey"),
    describe: () => request("describe")
  };
}

export function createOpaqueCapabilityKeyProvider({
  backend = process.env.PACT_OPAQUE_CAPABILITY_KEY_PROVIDER || "auto",
  alias = process.env.PACT_OPAQUE_CAPABILITY_KEY_ALIAS || DEFAULT_ALIAS,
  dataDir = process.env.PACT_OPAQUE_CAPABILITY_KEY_DATA_DIR || "",
  bindingStore = null,
  lookupKeySource = null,
  command = "",
  args = [],
  env = {}
} = {}) {
  const resolvedBackend = resolveAutoCapabilityKernelBackend(backend);
  const storageBackend = backend === "auto" ? "auto" : resolvedBackend;
  const sealedKernel = !bindingStore && resolvedBackend !== "memory"
    ? createSealedCapabilityKernelStore({ backend: storageBackend, dataDir, alias })
    : null;
  const store = bindingStore ||
    sealedKernel ||
    createMemoryCapabilityKeyBindingStore();
  const keySource = lookupKeySource ||
    sealedKernel?.keySource ||
    (resolvedBackend === "memory"
      ? createMemoryLookupKeySource()
      : createCommandLookupKeySource({
          alias,
          backend: ["macos-keychain", "local-file"].includes(resolvedBackend) ? resolvedBackend : "external-command",
          dataDir,
          command: command || process.env.PACT_OPAQUE_CAPABILITY_KEY_COMMAND || process.execPath,
          args: args.length
            ? args
            : command || process.env.PACT_OPAQUE_CAPABILITY_KEY_COMMAND
            ? String(process.env.PACT_OPAQUE_CAPABILITY_KEY_ARGS || "").split(/\s+/).filter(Boolean)
            : [helperScriptPath()],
          env
        }));
  let runtimeLookupKey = null;
  let runtimeLookupGeneration = 0;
  let runtimeLookupLoadCount = 0;
  let providerMutationQueue = Promise.resolve();

  function enqueueProviderMutation(action) {
    const run = providerMutationQueue.catch(() => {}).then(action);
    providerMutationQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function waitForProviderMutations() {
    await providerMutationQueue.catch(() => {});
  }

  async function getRuntimeLookupKey() {
    if (!runtimeLookupKey) {
      const loaded = await keySource.loadRuntimeLookupKey();
      runtimeLookupKey = Buffer.from(String(loaded.runtimeLookupKeyBase64 || ""), "base64");
      runtimeLookupGeneration = Number(loaded.generation || 0);
      runtimeLookupLoadCount += 1;
      if (runtimeLookupKey.length < 32) {
        throw new Error("Runtime lookup key helper returned an invalid key.");
      }
    }
    return runtimeLookupKey;
  }

  async function issue({
    capabilityKey = createCapabilityKey(),
    key = "",
    capabilities = [],
    ...input
  } = {}) {
    return enqueueProviderMutation(async () => {
      const rawKey = text(key || capabilityKey);
      rejectUnknownOpaqueCapabilities(capabilities);
      const lookupKey = await getRuntimeLookupKey();
      const keyHash = capabilityKeyHash(lookupKey, rawKey);
      const normalizedCapabilities = canonicalOpaqueCapabilities(capabilities);
      const record = createKeyRecord({ ...input, keyHash, capabilities: normalizedCapabilities });
      const capabilityHashes = normalizedCapabilities.map((capability) => capabilityPermissionHash(lookupKey, capability));
      await store.put(record, capabilityHashes);
      return {
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        capabilityKey: rawKey,
        credentialId: record.credentialId,
        status: record.status,
        capabilitySetHash: record.capabilitySetHash,
        capabilityCount: record.capabilityCount,
        expiresAt: record.expiresAt,
        runtimeLookupGeneration
      };
    });
  }

  async function verify({
    capabilityKey = "",
    key = "",
    requiredCapability = "",
    requiredCapabilities = [],
    now = nowIso(),
    minGrantVersion = 0,
    includeRecordDetails = false
  } = {}) {
    const rawKey = text(key || capabilityKey);
    if (!rawKey) {
      return { ok: false, reasonCode: "capability_key_missing" };
    }
    await waitForProviderMutations();
    const unknownRequired = unknownKernelCapabilities(requiredCapability ? [requiredCapability] : requiredCapabilities);
    if (unknownRequired.length > 0) {
      return {
        ok: false,
        reasonCode: "unknown_capability",
        unknownCapabilities: unknownRequired,
        keyHash: "",
        runtimeLookupGeneration
      };
    }
    const required = canonicalOpaqueCapabilities(requiredCapability ? [requiredCapability] : requiredCapabilities);
    if (required.length === 0) {
      return { ok: false, reasonCode: "capability_required" };
    }
    const lookupKey = await getRuntimeLookupKey();
    const keyHash = capabilityKeyHash(lookupKey, rawKey);
    const recordCheck = validateKeyRecord(await store.get(keyHash), { now, minGrantVersion });
    if (!recordCheck.ok) {
      return { ...recordCheck, keyHash: "", runtimeLookupGeneration };
    }
    const missingCapabilities = [];
    for (const capability of required) {
      const candidateHashes = candidateCapabilitiesFor(capability)
        .map((candidate) => capabilityPermissionHash(lookupKey, candidate));
      if (!(await store.hasCapability(keyHash, candidateHashes))) {
        missingCapabilities.push(capability);
      }
    }
    if (missingCapabilities.length > 0) {
      return {
        ok: false,
        reasonCode: "missing_capabilities",
        credentialId: recordCheck.record.credentialId,
        missingCapabilities,
        keyHash: "",
        runtimeLookupGeneration
      };
    }
    const decision = {
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: recordCheck.record.credentialId,
      requiredCapabilities: required,
      missingCapabilities: [],
      expiresAt: recordCheck.record.expiresAt,
      runtimeLookupGeneration
    };
    if (includeRecordDetails === true) {
      return {
        ...decision,
        keyHash,
        capabilitySetHash: recordCheck.record.capabilitySetHash,
        capabilityCount: recordCheck.record.capabilityCount,
        grantVersion: recordCheck.record.grantVersion,
        constraints: recordCheck.record.constraints,
        metadata: recordCheck.record.metadata
      };
    }
    return decision;
  }

  async function invalidate({ capabilityKey = "", key = "", reason = "" } = {}) {
    return enqueueProviderMutation(async () => {
      const rawKey = text(key || capabilityKey);
      if (!rawKey) {
        return null;
      }
      const lookupKey = await getRuntimeLookupKey();
      const keyHash = capabilityKeyHash(lookupKey, rawKey);
      return store.invalidate(keyHash, reason);
    });
  }

  async function invalidateCredential({ credentialId = "", reason = "" } = {}) {
    return enqueueProviderMutation(async () => {
      const resolvedCredentialId = text(credentialId);
      if (!resolvedCredentialId) {
        return [];
      }
      const records = await store.list({ includeInvalid: false });
      const invalidated = [];
      for (const record of records) {
        if (record.credentialId !== resolvedCredentialId) {
          continue;
        }
        const updated = await store.invalidate(record.keyHash, reason);
        if (updated) {
          invalidated.push(updated);
        }
      }
      return invalidated;
    });
  }

  async function rotateCapabilityKey({ capabilityKey = "", key = "", capabilities = [], reason = "rotated", ...input } = {}) {
    return enqueueProviderMutation(async () => {
      const rawKey = text(key || capabilityKey);
      const lookupKey = await getRuntimeLookupKey();
      const oldHash = capabilityKeyHash(lookupKey, rawKey);
      const existing = await store.get(oldHash);
      if (!existing || existing.status !== "valid") {
        return { ok: false, reasonCode: "capability_key_invalid" };
      }
      rejectUnknownOpaqueCapabilities(capabilities);
      const normalizedCapabilities = canonicalOpaqueCapabilities(capabilities);
      if (normalizedCapabilities.length === 0) {
        return { ok: false, reasonCode: "capabilities_required_for_rotation" };
      }
      await store.invalidate(oldHash, reason);
      const newCapabilityKey = createCapabilityKey();
      const newHash = capabilityKeyHash(lookupKey, newCapabilityKey);
      const newRecord = createKeyRecord({
        ...existing,
        ...input,
        keyHash: newHash,
        capabilities: normalizedCapabilities,
        status: "valid",
        issuedAt: nowIso()
      });
      await store.put(newRecord, normalizedCapabilities.map((capability) => capabilityPermissionHash(lookupKey, capability)));
      return {
        ok: true,
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        capabilityKey: newCapabilityKey,
        credentialId: newRecord.credentialId,
        oldStatus: "invalid",
        status: "valid",
        runtimeLookupGeneration
      };
    });
  }

  async function describe() {
    await waitForProviderMutations();
    const keySourceDescription = typeof keySource.describe === "function"
      ? await keySource.describe()
      : {};
    return {
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      provider: resolvedBackend,
      securityMode: keySourceDescription.securityMode || (resolvedBackend === "local-file"
        ? "degraded_file_fallback"
        : resolvedBackend === "macos-keychain"
          ? "keyring"
          : ""),
      alias,
      runtimeLookupGeneration,
      runtimeLookupLoaded: Boolean(runtimeLookupKey),
      runtimeLookupLoadCount,
      bindingCount: (await store.list({ includeInvalid: true })).length,
      permissionBindingCount: keySourceDescription.permissionBindingCount,
      stateRoot: keySourceDescription.stateRoot || "",
      linuxDetectedBackends: Array.isArray(keySourceDescription.linuxDetectedBackends)
        ? keySourceDescription.linuxDetectedBackends
        : [],
      keySource: {
        provider: keySourceDescription.provider || resolvedBackend,
        securityMode: keySourceDescription.securityMode || "",
        generation: keySourceDescription.generation || 0,
        loadCount: keySourceDescription.loadCount,
        runtimeLookupKeyRotationSupported: keySourceDescription.runtimeLookupKeyRotationSupported === true
      }
    };
  }

  async function exportRecoveryPackage(input = {}) {
    await waitForProviderMutations();
    if (typeof store.exportRecoveryPackage !== "function") {
      throw new Error("Capability key provider backend does not support recovery export.");
    }
    return store.exportRecoveryPackage(input);
  }

  async function importRecoveryPackage(input = {}) {
    if (typeof store.importRecoveryPackage !== "function") {
      throw new Error("Capability key provider backend does not support recovery import.");
    }
    return enqueueProviderMutation(async () => {
      runtimeLookupKey = null;
      runtimeLookupGeneration = 0;
      return store.importRecoveryPackage(input);
    });
  }

  return Object.freeze({
    protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
    provider: resolvedBackend,
    alias,
    issue,
    verify,
    invalidate,
    invalidateCredential,
    rotateCapabilityKey,
    exportRecoveryPackage,
    importRecoveryPackage,
    describe,
    store,
    close() {
      store.close?.();
    }
  });
}

export function createMemoryOpaqueCapabilityKeyProvider(input = {}) {
  return createOpaqueCapabilityKeyProvider({ ...input, backend: "memory" });
}

export function createCommandOpaqueCapabilityKeyProvider(input = {}) {
  return createOpaqueCapabilityKeyProvider({
    ...input,
    backend: input.backend || (process.platform === "darwin" ? "macos-keychain" : "local-file")
  });
}
