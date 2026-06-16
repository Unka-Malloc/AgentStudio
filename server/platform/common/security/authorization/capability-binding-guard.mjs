import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ServerConfig } from "../../config/ServerConfig.mjs";

export const CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION = "v0.0.1:risk-control:capability-binding-guard-1";

const DEFAULT_ALIAS = "pact-tool-bindings";
const DEFAULT_NAMESPACE = "tool-management";
const STATE_VERSION = 1;
const VALID_STATUSES = Object.freeze(["valid", "invalid"]);
const RECOVERY_PACKAGE_VERSION = "v0.0.1:risk-control:capability-binding-guard-recovery-1";
const AEAD_ALGORITHM = "aes-256-gcm";

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value || "").trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function parseIso(value = "") {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed === undefined || parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function stableJson(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function randomBase64(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64");
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

function normalizeStatus(status = "valid") {
  const value = text(status || "valid");
  return VALID_STATUSES.includes(value) ? value : "invalid";
}

function hashBase64Url(value = "") {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("base64url");
}

function lookupHmac(lookupKey, label = "", value = "") {
  const key = Buffer.isBuffer(lookupKey)
    ? lookupKey
    : Buffer.from(String(lookupKey || ""), "base64");
  if (key.length < 32) {
    throw new Error("Capability binding guard requires a 256-bit lookup key.");
  }
  return crypto.createHmac("sha256", key)
    .update(`${String(label || "")}\0${String(value || "")}`, "utf8")
    .digest("base64url");
}

export function capabilityBindingGuardStatePath({ dataDir = "", alias = DEFAULT_ALIAS } = {}) {
  return path.join(resolveDataDir(dataDir), "security", "capability-binding-guard", `${safeAlias(alias)}.sealed.json`);
}

function capabilityBindingGuardLocalSealingKeyPath({ dataDir = "", alias = DEFAULT_ALIAS } = {}) {
  return path.join(resolveDataDir(dataDir), "security", "capability-binding-guard", `${safeAlias(alias)}.sealing-key`);
}

function capabilityBindingGuardLockPath({ dataDir = "", alias = DEFAULT_ALIAS } = {}) {
  return path.join(resolveDataDir(dataDir), "security", "locks", `capability-binding-guard-${safeAlias(alias)}.lock`);
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
        throw new Error(`Timed out waiting for capability binding guard state lock: ${lockPath}`);
      }
      await sleep(20 + Math.floor(Math.random() * 30));
    }
  }
}

export function normalizeCapabilityBindingContext(input = {}) {
  const source = asObject(input);
  const userId = text(
    source.boundUserId ||
      source.bound_user_id ||
      source.userId ||
      source.user_id ||
      source.subjectId ||
      source.subject_id
  );
  const agentId = text(
    source.agentId ||
      source.agent_id ||
      source.agentProfileId ||
      source.agent_profile_id ||
      source.profileId ||
      source.profile_id
  );
  const clientId = text(source.clientId || source.client_id || source.clientName || source.client_name);
  const serverId = text(source.serverId || source.server_id);
  const packageId = text(source.packageId || source.package_id || source.identityPackageId || source.identity_package_id);
  const processKeyId = text(source.processKeyId || source.process_key_id);
  const processPublicKeyHash = text(source.processPublicKeyHash || source.process_public_key_hash);
  const fingerprintId = text(source.fingerprintId || source.fingerprint_id || source.clientFingerprintId || source.client_fingerprint_id);
  const machineInstanceId = text(source.machineInstanceId || source.machine_instance_id);
  const appInstanceId = text(source.appInstanceId || source.app_instance_id);
  const runtimeInstanceId = text(source.runtimeInstanceId || source.runtime_instance_id);
  const clientFingerprintHash = text(source.clientFingerprintHash || source.client_fingerprint_hash || source.fingerprintHash || source.fingerprint_hash);
  const identityGeneration = text(source.identityGeneration || source.identity_generation);
  const defaultIdentityHash = text(source.defaultIdentityHash || source.default_identity_hash);
  return {
    namespace: text(source.namespace || source.bindingNamespace || source.binding_namespace || DEFAULT_NAMESPACE) || DEFAULT_NAMESPACE,
    userId,
    boundUserId: userId,
    agentId,
    agentProfileId: agentId,
    clientId,
    serverId,
    packageId,
    processKeyId,
    processPublicKeyHash,
    fingerprintId,
    machineInstanceId,
    appInstanceId,
    runtimeInstanceId,
    clientFingerprintHash,
    identityGeneration,
    defaultIdentityHash
  };
}

export function capabilityBindingKeyHash(lookupKey, capabilityKey = "") {
  return lookupHmac(lookupKey, "capability-key", capabilityKey);
}

export function capabilityBindingSubjectHash(lookupKey, subjectType = "", value = "") {
  return lookupHmac(lookupKey, `subject:${subjectType}`, value);
}

function publicBindingRecord(record = null) {
  if (!record) {
    return null;
  }
  return {
    protocolVersion: CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
    bindingId: text(record.bindingId),
    keyHash: text(record.keyHash),
    credentialId: text(record.credentialId),
    status: normalizeStatus(record.status),
    namespaceHash: text(record.namespaceHash),
    userHash: text(record.userHash),
    agentHash: text(record.agentHash),
    clientHash: text(record.clientHash),
    serverHash: text(record.serverHash),
    packageHash: text(record.packageHash),
    processKeyHash: text(record.processKeyHash),
    processPublicKeyHashHash: text(record.processPublicKeyHashHash),
    fingerprintIdHash: text(record.fingerprintIdHash),
    machineInstanceHash: text(record.machineInstanceHash),
    appInstanceHash: text(record.appInstanceHash),
    runtimeInstanceHash: text(record.runtimeInstanceHash),
    clientFingerprintHashHash: text(record.clientFingerprintHashHash),
    identityGenerationHash: text(record.identityGenerationHash),
    defaultIdentityHashHash: text(record.defaultIdentityHashHash),
    requireNamespace: record.requireNamespace !== false,
    requireUser: record.requireUser === true,
    requireAgent: record.requireAgent === true,
    requireClient: record.requireClient === true,
    requireServer: record.requireServer === true,
    requirePackage: record.requirePackage === true,
    requireProcessKey: record.requireProcessKey === true,
    requireProcessPublicKey: record.requireProcessPublicKey === true,
    requireFingerprintId: record.requireFingerprintId === true,
    requireMachineInstance: record.requireMachineInstance === true,
    requireAppInstance: record.requireAppInstance === true,
    requireRuntimeInstance: record.requireRuntimeInstance === true,
    requireClientFingerprint: record.requireClientFingerprint === true,
    requireIdentityGeneration: record.requireIdentityGeneration === true,
    requireDefaultIdentity: record.requireDefaultIdentity === true,
    bindingStrength: text(record.bindingStrength || "namespace"),
    issuedAt: text(record.issuedAt),
    expiresAt: text(record.expiresAt),
    invalidatedAt: text(record.invalidatedAt),
    invalidationReason: text(record.invalidationReason),
    createdAt: text(record.createdAt),
    updatedAt: text(record.updatedAt)
  };
}

function bindingRecordFromContext(lookupKey, {
  capabilityKey = "",
  credentialId = "",
  context = {},
  expiresAt = "",
  ttlMs = 0,
  issuedAt = nowIso(),
  status = "valid"
} = {}) {
  const normalized = normalizeCapabilityBindingContext(context);
  const keyHash = capabilityBindingKeyHash(lookupKey, capabilityKey);
  const requireUser = Boolean(normalized.userId);
  const requireAgent = Boolean(normalized.agentId);
  const requireClient = Boolean(normalized.clientId);
  const requireServer = Boolean(normalized.serverId);
  const requirePackage = Boolean(normalized.packageId);
  const requireProcessKey = Boolean(normalized.processKeyId);
  const requireProcessPublicKey = Boolean(normalized.processPublicKeyHash);
  const requireFingerprintId = Boolean(normalized.fingerprintId);
  const requireMachineInstance = Boolean(normalized.machineInstanceId);
  const requireAppInstance = Boolean(normalized.appInstanceId);
  const requireRuntimeInstance = Boolean(normalized.runtimeInstanceId);
  const requireClientFingerprint = Boolean(normalized.clientFingerprintHash);
  const requireIdentityGeneration = Boolean(normalized.identityGeneration);
  const requireDefaultIdentity = Boolean(normalized.defaultIdentityHash);
  const strengths = [
    requireUser ? "user" : "",
    requireAgent ? "agent" : "",
    requireClient ? "client" : "",
    requireServer ? "server" : "",
    requirePackage ? "package" : "",
    requireProcessKey ? "process-key" : "",
    requireProcessPublicKey ? "process-public-key" : "",
    requireFingerprintId ? "fingerprint-id" : "",
    requireMachineInstance ? "machine-instance" : "",
    requireAppInstance ? "app-instance" : "",
    requireRuntimeInstance ? "runtime-instance" : "",
    requireClientFingerprint ? "client-fingerprint" : "",
    requireIdentityGeneration ? "identity-generation" : "",
    requireDefaultIdentity ? "default-identity" : ""
  ].filter(Boolean);
  const timestamp = nowIso();
  return publicBindingRecord({
    bindingId: `cap_bind_${crypto.randomUUID()}`,
    keyHash,
    credentialId: text(credentialId),
    status,
    namespaceHash: capabilityBindingSubjectHash(lookupKey, "namespace", normalized.namespace),
    userHash: requireUser ? capabilityBindingSubjectHash(lookupKey, "user", normalized.userId) : "",
    agentHash: requireAgent ? capabilityBindingSubjectHash(lookupKey, "agent", normalized.agentId) : "",
    clientHash: requireClient ? capabilityBindingSubjectHash(lookupKey, "client", normalized.clientId) : "",
    serverHash: requireServer ? capabilityBindingSubjectHash(lookupKey, "server", normalized.serverId) : "",
    packageHash: requirePackage ? capabilityBindingSubjectHash(lookupKey, "package", normalized.packageId) : "",
    processKeyHash: requireProcessKey ? capabilityBindingSubjectHash(lookupKey, "process-key", normalized.processKeyId) : "",
    processPublicKeyHashHash: requireProcessPublicKey ? capabilityBindingSubjectHash(lookupKey, "process-public-key", normalized.processPublicKeyHash) : "",
    fingerprintIdHash: requireFingerprintId ? capabilityBindingSubjectHash(lookupKey, "fingerprint-id", normalized.fingerprintId) : "",
    machineInstanceHash: requireMachineInstance ? capabilityBindingSubjectHash(lookupKey, "machine-instance", normalized.machineInstanceId) : "",
    appInstanceHash: requireAppInstance ? capabilityBindingSubjectHash(lookupKey, "app-instance", normalized.appInstanceId) : "",
    runtimeInstanceHash: requireRuntimeInstance ? capabilityBindingSubjectHash(lookupKey, "runtime-instance", normalized.runtimeInstanceId) : "",
    clientFingerprintHashHash: requireClientFingerprint ? capabilityBindingSubjectHash(lookupKey, "client-fingerprint", normalized.clientFingerprintHash) : "",
    identityGenerationHash: requireIdentityGeneration ? capabilityBindingSubjectHash(lookupKey, "identity-generation", normalized.identityGeneration) : "",
    defaultIdentityHashHash: requireDefaultIdentity ? capabilityBindingSubjectHash(lookupKey, "default-identity", normalized.defaultIdentityHash) : "",
    requireNamespace: true,
    requireUser,
    requireAgent,
    requireClient,
    requireServer,
    requirePackage,
    requireProcessKey,
    requireProcessPublicKey,
    requireFingerprintId,
    requireMachineInstance,
    requireAppInstance,
    requireRuntimeInstance,
    requireClientFingerprint,
    requireIdentityGeneration,
    requireDefaultIdentity,
    bindingStrength: strengths.length ? strengths.join("+") : "namespace",
    issuedAt,
    expiresAt: expiresAt || (ttlMs ? new Date(parseIso(issuedAt) + Math.max(1, Number(ttlMs || 0))).toISOString() : ""),
    invalidatedAt: "",
    invalidationReason: "",
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function normalizeState(input = {}) {
  const state = asObject(input);
  const normalized = {
    stateVersion: Number(state.stateVersion || STATE_VERSION),
    provider: text(state.provider || "unknown"),
    securityMode: text(state.securityMode || "unknown"),
    epoch: Math.max(1, Number(state.epoch || 1)),
    bindingLookupKeyBase64: text(state.bindingLookupKeyBase64),
    bindings: Array.isArray(state.bindings) ? state.bindings.map(publicBindingRecord).filter(Boolean) : [],
    events: Array.isArray(state.events) ? state.events.slice(-2048).map((event) => asObject(event)) : [],
    createdAt: text(state.createdAt || nowIso()),
    updatedAt: text(state.updatedAt || nowIso()),
    stateRoot: text(state.stateRoot)
  };
  if (!normalized.bindingLookupKeyBase64 || Buffer.from(normalized.bindingLookupKeyBase64, "base64").length < 32) {
    normalized.bindingLookupKeyBase64 = randomBase64(32);
  }
  normalized.stateRoot = stateRoot(normalized);
  return normalized;
}

function stateRoot(state = {}) {
  const normalized = {
    stateVersion: Number(state.stateVersion || STATE_VERSION),
    provider: text(state.provider),
    securityMode: text(state.securityMode),
    epoch: Number(state.epoch || 1),
    bindingLookupKeyHash: hashBase64Url(text(state.bindingLookupKeyBase64)),
    bindings: Array.isArray(state.bindings)
      ? state.bindings.map(publicBindingRecord).sort((a, b) => `${a.keyHash}:${a.bindingId}`.localeCompare(`${b.keyHash}:${b.bindingId}`))
      : []
  };
  return crypto.createHash("sha256").update(stableJson(normalized), "utf8").digest("base64url");
}

function legacyPublicBindingRecordV1(record = null) {
  if (!record) {
    return null;
  }
  return {
    protocolVersion: CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
    bindingId: text(record.bindingId),
    keyHash: text(record.keyHash),
    credentialId: text(record.credentialId),
    status: normalizeStatus(record.status),
    namespaceHash: text(record.namespaceHash),
    userHash: text(record.userHash),
    agentHash: text(record.agentHash),
    clientHash: text(record.clientHash),
    serverHash: text(record.serverHash),
    packageHash: text(record.packageHash),
    processKeyHash: text(record.processKeyHash),
    processPublicKeyHashHash: text(record.processPublicKeyHashHash),
    identityGenerationHash: text(record.identityGenerationHash),
    defaultIdentityHashHash: text(record.defaultIdentityHashHash),
    requireNamespace: record.requireNamespace !== false,
    requireUser: record.requireUser === true,
    requireAgent: record.requireAgent === true,
    requireClient: record.requireClient === true,
    requireServer: record.requireServer === true,
    requirePackage: record.requirePackage === true,
    requireProcessKey: record.requireProcessKey === true,
    requireProcessPublicKey: record.requireProcessPublicKey === true,
    requireIdentityGeneration: record.requireIdentityGeneration === true,
    requireDefaultIdentity: record.requireDefaultIdentity === true,
    bindingStrength: text(record.bindingStrength || "namespace"),
    issuedAt: text(record.issuedAt),
    expiresAt: text(record.expiresAt),
    invalidatedAt: text(record.invalidatedAt),
    invalidationReason: text(record.invalidationReason),
    createdAt: text(record.createdAt),
    updatedAt: text(record.updatedAt)
  };
}

function legacyStateRootV1(state = {}) {
  const normalized = {
    stateVersion: Number(state.stateVersion || STATE_VERSION),
    provider: text(state.provider),
    securityMode: text(state.securityMode),
    epoch: Number(state.epoch || 1),
    bindingLookupKeyHash: hashBase64Url(text(state.bindingLookupKeyBase64)),
    bindings: Array.isArray(state.bindings)
      ? state.bindings.map(legacyPublicBindingRecordV1).sort((a, b) => `${a.keyHash}:${a.bindingId}`.localeCompare(`${b.keyHash}:${b.bindingId}`))
      : []
  };
  return crypto.createHash("sha256").update(stableJson(normalized), "utf8").digest("base64url");
}

function sealJson({ sealingKeyBase64 = "", payload = {} } = {}) {
  const key = Buffer.from(text(sealingKeyBase64), "base64");
  if (key.length < 32) {
    throw new Error("Capability binding guard state sealing key must be at least 256 bits.");
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
    throw new Error("Capability binding guard state sealing key must be at least 256 bits.");
  }
  const sealedObject = asObject(sealed, null);
  if (!sealedObject || sealedObject.algorithm !== AEAD_ALGORITHM) {
    throw new Error("Unsupported capability binding guard sealed state payload.");
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

function keychainService(alias = DEFAULT_ALIAS) {
  return `com.unka-malloc.pact.capability-binding-guard.${safeAlias(alias)}`;
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
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${command} failed with exit code ${code}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.end(input);
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

function linuxBindingGuardBackendCandidates() {
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

function firstUsableLinuxBindingGuardBackend() {
  return linuxBindingGuardBackendCandidates()[0] || "local-file";
}

function resolveAutoBindingGuardBackend(backend = "auto") {
  if (backend !== "auto") {
    return backend;
  }
  if (process.platform === "darwin") {
    return "macos-keychain";
  }
  if (process.platform === "linux") {
    return firstUsableLinuxBindingGuardBackend();
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
  return path.join(resolveDataDir(dataDir), "security", "capability-binding-guard", `${safeAlias(alias)}.dpapi`);
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
  return `pact:capability-binding-guard:${safeAlias(alias)}`;
}

function secretToolAttributes(alias = DEFAULT_ALIAS) {
  return [
    "application",
    "pact",
    "component",
    "capability-binding-guard",
    "alias",
    safeAlias(alias)
  ];
}

function passEntryName(alias = DEFAULT_ALIAS) {
  return `pact/capability-binding-guard/${safeAlias(alias)}`;
}

function createRecord({ alias = DEFAULT_ALIAS, provider = "local-file", securityMode = "degraded_file_fallback", state = null, sealingKeyBase64 = "" } = {}) {
  const timestamp = nowIso();
  const normalizedState = normalizeState(state || {
    provider,
    securityMode,
    bindingLookupKeyBase64: randomBase64(32),
    bindings: [],
    events: [],
    createdAt: timestamp,
    updatedAt: timestamp
  });
  const sealingKey = sealingKeyBase64 || randomBase64(32);
  return {
    protocolVersion: CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
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

async function readLocalRecord({ dataDir = "", alias = DEFAULT_ALIAS, provider = "local-file", securityMode = "degraded_file_fallback" } = {}) {
  const filePath = capabilityBindingGuardStatePath({ dataDir, alias });
  try {
    const record = parseJson(await fs.promises.readFile(filePath, "utf8"), null);
    if (record && !record.sealingKeyBase64) {
      record.sealingKeyBase64 = text(await fs.promises.readFile(
        capabilityBindingGuardLocalSealingKeyPath({ dataDir, alias }),
        "utf8"
      ));
    }
    return record;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return createRecord({ alias, provider, securityMode });
    }
    throw error;
  }
}

async function writeLocalRecord({ dataDir = "", alias = DEFAULT_ALIAS } = {}, record = {}) {
  const filePath = capabilityBindingGuardStatePath({ dataDir, alias });
  const sealingKey = text(record.sealingKeyBase64);
  if (!sealingKey) {
    throw new Error("Local capability binding fallback requires a sealing key sidecar.");
  }
  await writePrivateFileAtomic(capabilityBindingGuardLocalSealingKeyPath({ dataDir, alias }), `${sealingKey}\n`);
  const { sealingKeyBase64, ...persistedRecord } = record;
  void sealingKeyBase64;
  await writePrivateFileAtomic(filePath, `${JSON.stringify(persistedRecord, null, 2)}\n`);
  return record;
}

async function readMacosRecord({ alias = DEFAULT_ALIAS } = {}) {
  if (process.platform !== "darwin") {
    throw new Error("macos-keychain capability binding guard backend is only available on macOS.");
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
      return createRecord({ alias, provider: "macos-keychain", securityMode: "keyring" });
    }
    throw error;
  }
}

async function writeMacosRecord({ alias = DEFAULT_ALIAS } = {}, record = {}) {
  if (process.platform !== "darwin") {
    throw new Error("macos-keychain capability binding guard backend is only available on macOS.");
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

async function readLinuxKeyringRecord({ alias = DEFAULT_ALIAS } = {}) {
  const description = linuxKeyringDescription(alias);
  let serial = "";
  try {
    serial = (await runText("keyctl", ["search", "@u", "user", description])).trim();
  } catch (error) {
    if (/not found|cannot find|requested key not available|key has been revoked/i.test(error.message)) {
      return createRecord({ alias, provider: "linux-kernel-keyring", securityMode: "keyring" });
    }
    throw error;
  }
  if (!serial) {
    return createRecord({ alias, provider: "linux-kernel-keyring", securityMode: "keyring" });
  }
  const raw = await runText("keyctl", ["pipe", serial]);
  return parseJson(raw.trim(), null);
}

async function writeLinuxKeyringRecord({ alias = DEFAULT_ALIAS } = {}, record = {}) {
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

async function readSecretServiceRecord({ alias = DEFAULT_ALIAS } = {}) {
  try {
    const raw = await runText("secret-tool", ["lookup", ...secretToolAttributes(alias)]);
    return parseJson(raw.trim(), null);
  } catch (error) {
    if (/no such object|not found|couldn't find|cannot autolaunch/i.test(error.message)) {
      return createRecord({ alias, provider: "secret-service", securityMode: "keyring" });
    }
    throw error;
  }
}

async function writeSecretServiceRecord({ alias = DEFAULT_ALIAS } = {}, record = {}) {
  await runText("secret-tool", [
    "store",
    "--label",
    `Pact Capability Binding Guard ${safeAlias(alias)}`,
    ...secretToolAttributes(alias)
  ], { input: JSON.stringify(record) });
  return record;
}

async function readPassRecord({ alias = DEFAULT_ALIAS } = {}) {
  try {
    const raw = await runText("pass", ["show", passEntryName(alias)]);
    return parseJson(raw.trim(), null);
  } catch (error) {
    if (/not in the password store|is not in the password store|No such file|not found/i.test(error.message)) {
      return createRecord({ alias, provider: "pass-gpg", securityMode: "user_keyring" });
    }
    throw error;
  }
}

async function writePassRecord({ alias = DEFAULT_ALIAS } = {}, record = {}) {
  await runText("pass", ["insert", "-m", "-f", passEntryName(alias)], { input: JSON.stringify(record) });
  return record;
}

async function readWindowsDpapiRecord({ dataDir = "", alias = DEFAULT_ALIAS } = {}) {
  const filePath = windowsDpapiProtectedPath({ dataDir, alias });
  try {
    const protectedPayload = await fs.promises.readFile(filePath, "utf8");
    const raw = await runWindowsDpapi({ action: "unprotect", input: protectedPayload });
    return parseJson(raw.trim(), null);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return createRecord({ alias, provider: "windows-dpapi", securityMode: "dpapi" });
    }
    throw error;
  }
}

async function writeWindowsDpapiRecord({ dataDir = "", alias = DEFAULT_ALIAS } = {}, record = {}) {
  const filePath = windowsDpapiProtectedPath({ dataDir, alias });
  const protectedPayload = await runWindowsDpapi({ action: "protect", input: JSON.stringify(record) });
  await writePrivateFileAtomic(filePath, protectedPayload);
  return record;
}

function openState(record = {}) {
  const opened = openSealedJson({
    sealingKeyBase64: record.sealingKeyBase64,
    sealed: record.sealedState
  });
  const state = normalizeState({
    ...opened,
    provider: record.provider,
    securityMode: record.securityMode
  });
  if (record.stateRoot && state.stateRoot !== record.stateRoot) {
    const legacyOpened = {
      ...opened,
      provider: record.provider,
      securityMode: record.securityMode
    };
    if (legacyStateRootV1(legacyOpened) !== record.stateRoot) {
      throw new Error("Capability binding guard sealed state root mismatch.");
    }
  }
  return state;
}

function degradedLocalRecord(record = {}, { alias = DEFAULT_ALIAS } = {}) {
  const state = openState(record);
  return {
    ...createRecord({
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

function bindingGuardSecurityModeForProvider(provider = "") {
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

function rewrapBindingRecordForProvider(record = {}, { alias = DEFAULT_ALIAS, provider = "local-file" } = {}) {
  if (provider === "local-file") {
    return degradedLocalRecord(record, { alias });
  }
  const securityMode = bindingGuardSecurityModeForProvider(provider);
  const state = openState(record);
  return {
    ...createRecord({
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

async function readLinuxAutoRecord({ dataDir = "", alias = DEFAULT_ALIAS } = {}) {
  for (const candidate of linuxBindingGuardBackendCandidates()) {
    try {
      if (candidate === "linux-kernel-keyring") {
        return await readLinuxKeyringRecord({ alias });
      }
      if (candidate === "secret-service") {
        return await readSecretServiceRecord({ alias });
      }
      if (candidate === "pass-gpg") {
        return await readPassRecord({ alias });
      }
      return await readLocalRecord({
        dataDir,
        alias,
        provider: "local-file",
        securityMode: "degraded_file_fallback"
      });
    } catch {
      // Auto mode keeps scanning lower-priority Linux backends before file fallback.
    }
  }
  return readLocalRecord({
    dataDir,
    alias,
    provider: "local-file",
    securityMode: "degraded_file_fallback"
  });
}

async function writeLinuxAutoRecord({ dataDir = "", alias = DEFAULT_ALIAS } = {}, record = {}) {
  const candidates = linuxBindingGuardBackendCandidates();
  const startIndex = Math.max(0, candidates.indexOf(record.provider));
  const orderedCandidates = candidates.slice(startIndex);
  let lastError = null;
  for (const candidate of orderedCandidates) {
    const candidateRecord = candidate === record.provider
      ? record
      : rewrapBindingRecordForProvider(record, { alias, provider: candidate });
    try {
      if (candidate === "linux-kernel-keyring") {
        return await writeLinuxKeyringRecord({ alias }, candidateRecord);
      }
      if (candidate === "secret-service") {
        return await writeSecretServiceRecord({ alias }, candidateRecord);
      }
      if (candidate === "pass-gpg") {
        return await writePassRecord({ alias }, candidateRecord);
      }
      return await writeLocalRecord({ dataDir, alias }, candidateRecord);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    throw lastError;
  }
  return writeLocalRecord({ dataDir, alias }, degradedLocalRecord(record, { alias }));
}

async function readRecord({ backend = "auto", dataDir = "", alias = DEFAULT_ALIAS } = {}) {
  if ((backend === "auto" || backend === "macos-keychain") && process.platform === "darwin") {
    try {
      return await readMacosRecord({ alias });
    } catch (error) {
      if (backend === "macos-keychain") {
        throw error;
      }
    }
  }
  if (backend === "auto" && process.platform === "linux") {
    return readLinuxAutoRecord({ dataDir, alias });
  }
  const resolvedBackend = resolveAutoBindingGuardBackend(backend);
  if (resolvedBackend === "linux-kernel-keyring") {
    try {
      return await readLinuxKeyringRecord({ alias });
    } catch (error) {
      if (backend !== "auto") {
        throw error;
      }
    }
  }
  if (resolvedBackend === "secret-service") {
    try {
      return await readSecretServiceRecord({ alias });
    } catch (error) {
      if (backend !== "auto") {
        throw error;
      }
    }
  }
  if (resolvedBackend === "pass-gpg") {
    try {
      return await readPassRecord({ alias });
    } catch (error) {
      if (backend !== "auto") {
        throw error;
      }
    }
  }
  if (resolvedBackend === "windows-dpapi") {
    try {
      return await readWindowsDpapiRecord({ dataDir, alias });
    } catch (error) {
      if (backend !== "auto") {
        throw error;
      }
    }
  }
  return readLocalRecord({
    dataDir,
    alias,
    provider: backend === "auto" ? "local-file" : backend,
    securityMode: "degraded_file_fallback"
  });
}

async function writeRecord({ backend = "auto", dataDir = "", alias = DEFAULT_ALIAS } = {}, record = {}) {
  if (backend === "auto" && process.platform === "linux") {
    return writeLinuxAutoRecord({ dataDir, alias }, record);
  }
  if (record.provider === "macos-keychain" && process.platform === "darwin") {
    try {
      return await writeMacosRecord({ alias }, record);
    } catch (error) {
      if (backend !== "auto") {
        throw error;
      }
      return writeLocalRecord({ dataDir, alias }, degradedLocalRecord(record, { alias }));
    }
  }
  if (record.provider === "linux-kernel-keyring") {
    try {
      return await writeLinuxKeyringRecord({ alias }, record);
    } catch (error) {
      if (backend !== "auto") {
        throw error;
      }
      return writeLocalRecord({ dataDir, alias }, degradedLocalRecord(record, { alias }));
    }
  }
  if (record.provider === "secret-service") {
    try {
      return await writeSecretServiceRecord({ alias }, record);
    } catch (error) {
      if (backend !== "auto") {
        throw error;
      }
      return writeLocalRecord({ dataDir, alias }, degradedLocalRecord(record, { alias }));
    }
  }
  if (record.provider === "pass-gpg") {
    try {
      return await writePassRecord({ alias }, record);
    } catch (error) {
      if (backend !== "auto") {
        throw error;
      }
      return writeLocalRecord({ dataDir, alias }, degradedLocalRecord(record, { alias }));
    }
  }
  if (record.provider === "windows-dpapi") {
    try {
      return await writeWindowsDpapiRecord({ dataDir, alias }, record);
    } catch (error) {
      if (backend !== "auto") {
        throw error;
      }
      return writeLocalRecord({ dataDir, alias }, degradedLocalRecord(record, { alias }));
    }
  }
  return writeLocalRecord({ dataDir, alias }, {
    ...record,
    provider: record.provider || (backend === "auto" ? "local-file" : backend),
    securityMode: record.securityMode || "degraded_file_fallback"
  });
}

function validateBindingRecord(record = null, { now = nowIso() } = {}) {
  const normalized = publicBindingRecord(record);
  if (!normalized) {
    return { ok: false, reasonCode: "binding_unknown" };
  }
  if (normalized.status !== "valid") {
    return { ok: false, reasonCode: "binding_invalid", credentialId: normalized.credentialId };
  }
  if (normalized.expiresAt && parseIso(normalized.expiresAt) <= parseIso(now)) {
    return { ok: false, reasonCode: "binding_expired", credentialId: normalized.credentialId };
  }
  return { ok: true, record: normalized };
}

function matchesRecord(lookupKey, record = {}, context = {}, { now = nowIso() } = {}) {
  const checked = validateBindingRecord(record, { now });
  if (!checked.ok) {
    return checked;
  }
  const normalized = normalizeCapabilityBindingContext(context);
  const expectedNamespace = capabilityBindingSubjectHash(lookupKey, "namespace", normalized.namespace);
  if (record.requireNamespace !== false && record.namespaceHash !== expectedNamespace) {
    return { ok: false, reasonCode: "binding_namespace_mismatch", credentialId: record.credentialId };
  }
  if (record.requireUser) {
    if (!normalized.userId) {
      return { ok: false, reasonCode: "binding_user_missing", credentialId: record.credentialId };
    }
    if (record.userHash !== capabilityBindingSubjectHash(lookupKey, "user", normalized.userId)) {
      return { ok: false, reasonCode: "binding_user_mismatch", credentialId: record.credentialId };
    }
  }
  if (record.requireAgent) {
    if (!normalized.agentId) {
      return { ok: false, reasonCode: "binding_agent_missing", credentialId: record.credentialId };
    }
    if (record.agentHash !== capabilityBindingSubjectHash(lookupKey, "agent", normalized.agentId)) {
      return { ok: false, reasonCode: "binding_agent_mismatch", credentialId: record.credentialId };
    }
  }
  if (record.requireClient) {
    if (!normalized.clientId) {
      return { ok: false, reasonCode: "binding_client_missing", credentialId: record.credentialId };
    }
    if (record.clientHash !== capabilityBindingSubjectHash(lookupKey, "client", normalized.clientId)) {
      return { ok: false, reasonCode: "binding_client_mismatch", credentialId: record.credentialId };
    }
  }
  if (record.requireServer) {
    if (!normalized.serverId) {
      return { ok: false, reasonCode: "binding_server_missing", credentialId: record.credentialId };
    }
    if (record.serverHash !== capabilityBindingSubjectHash(lookupKey, "server", normalized.serverId)) {
      return { ok: false, reasonCode: "binding_server_mismatch", credentialId: record.credentialId };
    }
  }
  if (record.requirePackage) {
    if (!normalized.packageId) {
      return { ok: false, reasonCode: "binding_package_missing", credentialId: record.credentialId };
    }
    if (record.packageHash !== capabilityBindingSubjectHash(lookupKey, "package", normalized.packageId)) {
      return { ok: false, reasonCode: "binding_package_mismatch", credentialId: record.credentialId };
    }
  }
  if (record.requireProcessKey) {
    if (!normalized.processKeyId) {
      return { ok: false, reasonCode: "binding_process_key_missing", credentialId: record.credentialId };
    }
    if (record.processKeyHash !== capabilityBindingSubjectHash(lookupKey, "process-key", normalized.processKeyId)) {
      return { ok: false, reasonCode: "binding_process_key_mismatch", credentialId: record.credentialId };
    }
  }
  if (record.requireProcessPublicKey) {
    if (!normalized.processPublicKeyHash) {
      return { ok: false, reasonCode: "binding_process_public_key_missing", credentialId: record.credentialId };
    }
    if (record.processPublicKeyHashHash !== capabilityBindingSubjectHash(lookupKey, "process-public-key", normalized.processPublicKeyHash)) {
      return { ok: false, reasonCode: "binding_process_public_key_mismatch", credentialId: record.credentialId };
    }
  }
  if (record.requireFingerprintId) {
    if (!normalized.fingerprintId) {
      return { ok: false, reasonCode: "binding_fingerprint_id_missing", credentialId: record.credentialId };
    }
    if (record.fingerprintIdHash !== capabilityBindingSubjectHash(lookupKey, "fingerprint-id", normalized.fingerprintId)) {
      return { ok: false, reasonCode: "binding_fingerprint_id_mismatch", credentialId: record.credentialId };
    }
  }
  if (record.requireMachineInstance) {
    if (!normalized.machineInstanceId) {
      return { ok: false, reasonCode: "binding_machine_instance_missing", credentialId: record.credentialId };
    }
    if (record.machineInstanceHash !== capabilityBindingSubjectHash(lookupKey, "machine-instance", normalized.machineInstanceId)) {
      return { ok: false, reasonCode: "binding_machine_instance_mismatch", credentialId: record.credentialId };
    }
  }
  if (record.requireAppInstance) {
    if (!normalized.appInstanceId) {
      return { ok: false, reasonCode: "binding_app_instance_missing", credentialId: record.credentialId };
    }
    if (record.appInstanceHash !== capabilityBindingSubjectHash(lookupKey, "app-instance", normalized.appInstanceId)) {
      return { ok: false, reasonCode: "binding_app_instance_mismatch", credentialId: record.credentialId };
    }
  }
  if (record.requireRuntimeInstance) {
    if (!normalized.runtimeInstanceId) {
      return { ok: false, reasonCode: "binding_runtime_instance_missing", credentialId: record.credentialId };
    }
    if (record.runtimeInstanceHash !== capabilityBindingSubjectHash(lookupKey, "runtime-instance", normalized.runtimeInstanceId)) {
      return { ok: false, reasonCode: "binding_runtime_instance_mismatch", credentialId: record.credentialId };
    }
  }
  if (record.requireClientFingerprint) {
    if (!normalized.clientFingerprintHash) {
      return { ok: false, reasonCode: "binding_client_fingerprint_missing", credentialId: record.credentialId };
    }
    if (record.clientFingerprintHashHash !== capabilityBindingSubjectHash(lookupKey, "client-fingerprint", normalized.clientFingerprintHash)) {
      return { ok: false, reasonCode: "binding_client_fingerprint_mismatch", credentialId: record.credentialId };
    }
  }
  if (record.requireIdentityGeneration) {
    if (!normalized.identityGeneration) {
      return { ok: false, reasonCode: "binding_identity_generation_missing", credentialId: record.credentialId };
    }
    if (record.identityGenerationHash !== capabilityBindingSubjectHash(lookupKey, "identity-generation", normalized.identityGeneration)) {
      return { ok: false, reasonCode: "binding_identity_generation_mismatch", credentialId: record.credentialId };
    }
  }
  if (record.requireDefaultIdentity) {
    if (!normalized.defaultIdentityHash) {
      return { ok: false, reasonCode: "binding_default_identity_missing", credentialId: record.credentialId };
    }
    if (record.defaultIdentityHashHash !== capabilityBindingSubjectHash(lookupKey, "default-identity", normalized.defaultIdentityHash)) {
      return { ok: false, reasonCode: "binding_default_identity_mismatch", credentialId: record.credentialId };
    }
  }
  return {
    ok: true,
    reasonCode: "capability_binding_valid",
    credentialId: record.credentialId,
    bindingId: record.bindingId,
    bindingStrength: record.bindingStrength,
    requireUser: record.requireUser,
    requireAgent: record.requireAgent,
    requireClient: record.requireClient,
    requireServer: record.requireServer,
    requirePackage: record.requirePackage,
    requireProcessKey: record.requireProcessKey,
    requireProcessPublicKey: record.requireProcessPublicKey,
    requireFingerprintId: record.requireFingerprintId,
    requireMachineInstance: record.requireMachineInstance,
    requireAppInstance: record.requireAppInstance,
    requireRuntimeInstance: record.requireRuntimeInstance,
    requireClientFingerprint: record.requireClientFingerprint,
    requireIdentityGeneration: record.requireIdentityGeneration,
    requireDefaultIdentity: record.requireDefaultIdentity
  };
}

export function createCapabilityBindingGuard({
  backend = process.env.PACT_CAPABILITY_BINDING_GUARD_PROVIDER || "auto",
  alias = process.env.PACT_CAPABILITY_BINDING_GUARD_ALIAS || DEFAULT_ALIAS,
  dataDir = process.env.PACT_CAPABILITY_BINDING_GUARD_DATA_DIR || ""
} = {}) {
  const resolvedBackend = resolveAutoBindingGuardBackend(backend);
  const storageBackend = backend === "auto" ? "auto" : resolvedBackend;
  let loaded = false;
  let record = null;
  let state = null;
  let loadCount = 0;
  let saveCount = 0;
  let loadPromise = null;
  let mutationQueue = Promise.resolve();

  function enqueueMutation(action) {
    const run = mutationQueue.catch(() => {}).then(async () => {
      if (resolvedBackend === "memory") {
        return action();
      }
      return withPrivateFileLock(
        capabilityBindingGuardLockPath({ dataDir, alias }),
        async () => {
          if (loadPromise) {
            await loadPromise.catch(() => {});
          }
          loaded = false;
          state = null;
          loadPromise = null;
          return action();
        }
      );
    });
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
        if (resolvedBackend === "memory") {
          record = createRecord({ alias, provider: "memory", securityMode: "memory" });
        } else {
          record = await readRecord({ backend: storageBackend, dataDir, alias });
        }
        record.alias = safeAlias(alias);
        if (!record.sealingKeyBase64 || !record.sealedState) {
          record = createRecord({
            alias,
            provider: record.provider || (resolvedBackend === "macos-keychain" ? "macos-keychain" : "local-file"),
            securityMode: record.securityMode || (record.provider === "macos-keychain" ? "keyring" : "degraded_file_fallback")
          });
          if (resolvedBackend !== "memory") {
            record = await writeRecord({ backend: storageBackend, dataDir, alias }, record);
          }
        }
        state = openState(record);
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
    state = normalizeState({
      ...state,
      epoch: Number(state.epoch || 1) + 1,
      updatedAt: timestamp,
      events: [
        ...(Array.isArray(state.events) ? state.events : []),
        {
          eventId: `cap_bind_event_${crypto.randomUUID()}`,
          at: timestamp,
          ...asObject(event)
        }
      ].slice(-2048)
    });
    record = {
      ...record,
      generation: state.epoch,
      sealedState: sealJson({ sealingKeyBase64: record.sealingKeyBase64, payload: state }),
      stateRoot: state.stateRoot,
      updatedAt: timestamp
    };
    if (resolvedBackend !== "memory") {
      record = await writeRecord({ backend: storageBackend, dataDir, alias }, record);
    }
    saveCount += 1;
    return state;
  }

  async function bindCapabilityKey(input = {}) {
    return enqueueMutation(async () => {
      const rawKey = text(input.key || input.capabilityKey);
      if (!rawKey) {
        throw new Error("Capability binding guard requires an opaque capability key.");
      }
      await load();
      const lookupKey = Buffer.from(state.bindingLookupKeyBase64, "base64");
      const nextRecord = bindingRecordFromContext(lookupKey, {
        capabilityKey: rawKey,
        credentialId: input.credentialId,
        context: input.context || input.binding || input,
        expiresAt: input.expiresAt,
        ttlMs: input.ttlMs,
        issuedAt: input.issuedAt || nowIso(),
        status: input.status || "valid"
      });
      state = {
        ...state,
        bindings: [
          ...state.bindings.filter((item) => !(item.keyHash === nextRecord.keyHash && item.credentialId === nextRecord.credentialId)),
          nextRecord
        ]
      };
      await save({
        action: "bind",
        keyHash: nextRecord.keyHash,
        credentialId: nextRecord.credentialId,
        bindingStrength: nextRecord.bindingStrength
      });
      return {
        protocolVersion: CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
        credentialId: nextRecord.credentialId,
        bindingId: nextRecord.bindingId,
        bindingStrength: nextRecord.bindingStrength,
        requireUser: nextRecord.requireUser,
        requireAgent: nextRecord.requireAgent,
        requireClient: nextRecord.requireClient,
        requireServer: nextRecord.requireServer,
        requirePackage: nextRecord.requirePackage,
        requireProcessKey: nextRecord.requireProcessKey,
        requireProcessPublicKey: nextRecord.requireProcessPublicKey,
        requireFingerprintId: nextRecord.requireFingerprintId,
        requireMachineInstance: nextRecord.requireMachineInstance,
        requireAppInstance: nextRecord.requireAppInstance,
        requireRuntimeInstance: nextRecord.requireRuntimeInstance,
        requireClientFingerprint: nextRecord.requireClientFingerprint,
        requireIdentityGeneration: nextRecord.requireIdentityGeneration,
        requireDefaultIdentity: nextRecord.requireDefaultIdentity,
        expiresAt: nextRecord.expiresAt
      };
    });
  }

  async function verifyCapabilityKeyBinding(input = {}) {
    const rawKey = text(input.key || input.capabilityKey);
    if (!rawKey) {
      return { ok: false, reasonCode: "capability_key_missing" };
    }
    await waitForMutations();
    await load();
    const lookupKey = Buffer.from(state.bindingLookupKeyBase64, "base64");
    const keyHash = capabilityBindingKeyHash(lookupKey, rawKey);
    const credentialId = text(input.credentialId);
    const records = state.bindings.filter((item) => (
      item.keyHash === keyHash &&
      (!credentialId || item.credentialId === credentialId)
    ));
    if (records.length === 0) {
      return {
        ok: true,
        applicable: false,
        reasonCode: "capability_binding_not_registered"
      };
    }
    let lastDenied = null;
    for (const item of records) {
      const decision = matchesRecord(lookupKey, item, input.context || input.binding || input, { now: input.now || nowIso() });
      if (decision.ok) {
        return {
          ...decision,
          applicable: true
        };
      }
      lastDenied = decision;
    }
    return {
      ok: false,
      applicable: true,
      ...(lastDenied || { reasonCode: "capability_binding_denied" })
    };
  }

  async function invalidateCapabilityKeyBinding({ capabilityKey = "", key = "", credentialId = "", reason = "" } = {}) {
    return enqueueMutation(async () => {
      const rawKey = text(key || capabilityKey);
      await load();
      const lookupKey = Buffer.from(state.bindingLookupKeyBase64, "base64");
      const keyHash = rawKey ? capabilityBindingKeyHash(lookupKey, rawKey) : "";
      const resolvedCredentialId = text(credentialId);
      const timestamp = nowIso();
      const invalidated = [];
      state = {
        ...state,
        bindings: state.bindings.map((item) => {
          const matches = (keyHash && item.keyHash === keyHash) ||
            (resolvedCredentialId && item.credentialId === resolvedCredentialId);
          if (!matches || item.status !== "valid") {
            return item;
          }
          const updated = publicBindingRecord({
            ...item,
            status: "invalid",
            invalidatedAt: timestamp,
            invalidationReason: text(reason),
            updatedAt: timestamp
          });
          invalidated.push(updated);
          return updated;
        })
      };
      if (invalidated.length > 0) {
        await save({ action: "invalidate", credentialId: resolvedCredentialId, reason: text(reason), count: invalidated.length });
      }
      return invalidated;
    });
  }

  async function describe() {
    await waitForMutations();
    await load();
    const providerName = state.provider || record.provider || resolvedBackend;
    const securityMode = state.securityMode || record.securityMode || "";
    return {
      protocolVersion: CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
      provider: providerName,
      securityMode,
      alias: safeAlias(alias),
      degraded: securityMode === "degraded_file_fallback",
      runtimeLookupLoaded: loaded,
      loadCount,
      saveCount,
      bindingCount: state.bindings.length,
      activeBindingCount: state.bindings.filter((item) => item.status === "valid").length,
      stateRoot: state.stateRoot,
      statePath: providerName === "local-file" || securityMode === "degraded_file_fallback"
        ? capabilityBindingGuardStatePath({ dataDir, alias })
        : ""
    };
  }

  function recoveryKeyFromPassphrase(passphrase = "", saltBase64 = "") {
    const passphraseText = text(passphrase);
    if (!passphraseText) {
      throw new Error("Capability binding guard recovery export requires a passphrase.");
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
        throw new Error("Unsupported capability binding guard recovery package.");
      }
      const saltBase64 = text(packageObject.kdf?.saltBase64);
      const recoveryKeyBase64 = recoveryKeyFromPassphrase(passphrase, saltBase64);
      const opened = openSealedJson({
        sealingKeyBase64: recoveryKeyBase64,
        sealed: packageObject.sealedRecovery
      });
      const importedState = normalizeState(asObject(opened.state));
      const targetProvider = record?.provider || (
        resolvedBackend === "memory"
          ? "memory"
          : resolvedBackend === "macos-keychain"
            ? "macos-keychain"
            : "local-file"
      );
      const targetSecurityMode = record?.securityMode || (
        targetProvider === "memory"
          ? "memory"
          : targetProvider === "macos-keychain"
            ? "keyring"
            : "degraded_file_fallback"
      );
      state = {
        ...importedState,
        provider: targetProvider,
        securityMode: targetSecurityMode
      };
      record = record || createRecord({ alias, provider: state.provider, securityMode: state.securityMode, state });
      record = {
        ...record,
        generation: Number(state.epoch || 1),
        sealedState: sealJson({ sealingKeyBase64: record.sealingKeyBase64, payload: state }),
        stateRoot: state.stateRoot,
        updatedAt: nowIso()
      };
      loaded = true;
      if (resolvedBackend !== "memory") {
        record = await writeRecord({ backend: storageBackend, dataDir, alias }, record);
      }
      saveCount += 1;
      return {
        ok: true,
        protocolVersion: CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
        alias: safeAlias(alias),
        epoch: state.epoch,
        stateRoot: state.stateRoot,
        provider: record.provider,
        securityMode: record.securityMode
      };
    });
  }

  return Object.freeze({
    protocolVersion: CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
    provider: resolvedBackend,
    alias,
    bindCapabilityKey,
    verifyCapabilityKeyBinding,
    invalidateCapabilityKeyBinding,
    exportRecoveryPackage,
    importRecoveryPackage,
    describe,
    close() {}
  });
}

export function createMemoryCapabilityBindingGuard(input = {}) {
  return createCapabilityBindingGuard({ ...input, backend: "memory" });
}
