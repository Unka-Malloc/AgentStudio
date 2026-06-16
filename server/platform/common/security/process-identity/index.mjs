import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ServerConfig } from "../../config/ServerConfig.mjs";
import { apiCapabilityId } from "../authorization/authorization-engine.mjs";
import { createCapabilityBindingGuard } from "../authorization/capability-binding-guard.mjs";
import { createOpaqueCapabilityKeyProvider } from "../authorization/opaque-capability-key.mjs";
import { clientIpFromRequest, isLocalHttpHost, isLoopbackAddress } from "../trusted-client-ip.mjs";

export const PROCESS_IDENTITY_PROTOCOL_VERSION = "v0.0.1:risk-control:process-identity-1";
export const CLIENT_IDENTITY_PACKAGE_VERSION = "v0.0.1:process-identity:client-package-1";
export const PROCESS_IDENTITY_CANONICAL_REQUEST_VERSION = "PACT-PROCESS-IDENTITY-V1";
export const CLIENT_FINGERPRINT_VERSION = "v0.0.1:client:fingerprint-1";

const STATE_VERSION = 1;
const AEAD_ALGORITHM = "aes-256-gcm";
const DEFAULT_ALIAS = "pact-process-identity";
const DEFAULT_NONCE_TTL_MS = 5 * 60 * 1000;
const MAX_NONCE_CACHE = 4096;
const VALID_CLIENT_STATUSES = new Set(["valid", "rotated", "revoked"]);

export const DEFAULT_PROCESS_IDENTITY_CAPABILITIES = Object.freeze([
  apiCapabilityId("process_identity.package.rotate"),
  apiCapabilityId("process_identity.package.revoke")
]);

function nowIso() {
  return new Date().toISOString();
}

function text(value = "") {
  return String(value || "").trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    return value.split(",");
  }
  return [];
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((item) => text(item)).filter(Boolean))];
}

function stableJson(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256Base64Url(value) {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

function sha256TextBase64Url(value = "") {
  return sha256Base64Url(Buffer.from(String(value || ""), "utf8"));
}

function clientFingerprintHash({
  fingerprintId = "",
  machineInstanceId = "",
  appInstanceId = "",
  runtimeInstanceId = ""
} = {}) {
  return `sha256:${sha256TextBase64Url([
    CLIENT_FINGERPRINT_VERSION,
    text(fingerprintId),
    text(machineInstanceId),
    text(appInstanceId),
    text(runtimeInstanceId)
  ].join("\n"))}`;
}

function randomToken(prefix = "tok", bytes = 24) {
  return `${prefix}_${crypto.randomBytes(bytes).toString("base64url")}`;
}

function parseTimestampMs(value = "") {
  const raw = text(value);
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return 0;
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveDataDir(dataDir = "") {
  return path.resolve(text(dataDir) || ServerConfig.getDataDir());
}

function safeAlias(alias = DEFAULT_ALIAS) {
  return text(alias || DEFAULT_ALIAS).replace(/[^a-zA-Z0-9._:-]/g, "_") || DEFAULT_ALIAS;
}

function stateDir({ dataDir = "", alias = DEFAULT_ALIAS } = {}) {
  return path.join(resolveDataDir(dataDir), "security", "process-identity", safeAlias(alias));
}

export function processIdentityStatePath({ dataDir = "", alias = DEFAULT_ALIAS } = {}) {
  return path.join(stateDir({ dataDir, alias }), "state.sealed.json");
}

function processIdentitySealingKeyPath({ dataDir = "", alias = DEFAULT_ALIAS } = {}) {
  return path.join(stateDir({ dataDir, alias }), "state.sealing-key");
}

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

async function writePrivateFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  ensurePrivateDir(dir);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
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

function sealJson({ sealingKeyBase64 = "", payload = {} } = {}) {
  const key = Buffer.from(text(sealingKeyBase64), "base64");
  if (key.length < 32) {
    throw new Error("Process identity state sealing key must be at least 256 bits.");
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
    throw new Error("Process identity state sealing key must be at least 256 bits.");
  }
  const sealedObject = asObject(sealed, null);
  if (!sealedObject || sealedObject.algorithm !== AEAD_ALGORITHM) {
    throw new Error("Unsupported process identity sealed state payload.");
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
  return JSON.parse(plaintext);
}

function generateServerIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeySpki = publicKey.export({ format: "der", type: "spki" });
  const publicKeySpkiBase64 = publicKeySpki.toString("base64");
  const digest = sha256Base64Url(publicKeySpki);
  return {
    serverId: `srv_${digest.slice(0, 32)}`,
    serverKeyId: `srvkey_${digest.slice(0, 24)}`,
    serverTrustPin: `ed25519-spki-sha256:${digest}`,
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }),
    publicKeySpkiBase64,
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }),
    createdAt: nowIso()
  };
}

function publicServerIdentity(serverIdentity = {}) {
  return {
    protocolVersion: PROCESS_IDENTITY_PROTOCOL_VERSION,
    serverId: text(serverIdentity.serverId),
    serverKeyId: text(serverIdentity.serverKeyId),
    serverTrustPin: text(serverIdentity.serverTrustPin),
    publicKeyPem: text(serverIdentity.publicKeyPem),
    publicKeySpkiBase64: text(serverIdentity.publicKeySpkiBase64),
    createdAt: text(serverIdentity.createdAt)
  };
}

function normalizeClientRecord(record = {}) {
  const input = asObject(record);
  const clientFingerprint = normalizeClientFingerprint(input.clientFingerprint || input, { required: false });
  return {
    packageId: text(input.packageId),
    clientId: text(input.clientId),
    installationId: text(input.installationId),
    serverId: text(input.serverId),
    serverTrustPin: text(input.serverTrustPin),
    processKeyId: text(input.processKeyId),
    processPublicKeyPem: text(input.processPublicKeyPem),
    processPublicKeySpkiBase64: text(input.processPublicKeySpkiBase64),
    processPublicKeyHash: text(input.processPublicKeyHash),
    clientFingerprint,
    defaultIdentityHash: text(input.defaultIdentityHash),
    identityGeneration: Math.max(1, Number(input.identityGeneration || 1)),
    capabilityCredentialId: text(input.capabilityCredentialId),
    capabilities: uniqueStrings(asArray(input.capabilities)),
    status: VALID_CLIENT_STATUSES.has(text(input.status)) ? text(input.status) : "revoked",
    issuedAt: text(input.issuedAt),
    expiresAt: text(input.expiresAt),
    rotatedAt: text(input.rotatedAt),
    revokedAt: text(input.revokedAt),
    revocationReason: text(input.revocationReason)
  };
}

function normalizeState(input = {}) {
  const timestamp = nowIso();
  const source = asObject(input);
  const serverIdentity = asObject(source.serverIdentity, null) || generateServerIdentity();
  return {
    stateVersion: Number(source.stateVersion || STATE_VERSION),
    protocolVersion: PROCESS_IDENTITY_PROTOCOL_VERSION,
    alias: safeAlias(source.alias || DEFAULT_ALIAS),
    serverIdentity,
    claimed: source.claimed === true,
    claimedAt: text(source.claimedAt),
    claimCount: Math.max(0, Number(source.claimCount || 0)),
    clients: Array.isArray(source.clients) ? source.clients.map(normalizeClientRecord).filter((item) => item.packageId) : [],
    usedNonces: Array.isArray(source.usedNonces) ? source.usedNonces.slice(-MAX_NONCE_CACHE).map((item) => ({
      nonceHash: text(item.nonceHash),
      packageId: text(item.packageId),
      seenAt: text(item.seenAt),
      expiresAt: text(item.expiresAt)
    })).filter((item) => item.nonceHash) : [],
    createdAt: text(source.createdAt || timestamp),
    updatedAt: text(source.updatedAt || timestamp)
  };
}

function stateRoot(state = {}) {
  return sha256Base64Url(Buffer.from(stableJson({
    stateVersion: Number(state.stateVersion || STATE_VERSION),
    serverId: state.serverIdentity?.serverId || "",
    serverTrustPin: state.serverIdentity?.serverTrustPin || "",
    claimed: state.claimed === true,
    clients: (state.clients || []).map((client) => ({
      packageId: client.packageId,
      clientId: client.clientId,
      processKeyId: client.processKeyId,
      processPublicKeyHash: client.processPublicKeyHash,
      clientFingerprintHash: client.clientFingerprint?.fingerprintHash || "",
      identityGeneration: client.identityGeneration,
      capabilityCredentialId: client.capabilityCredentialId,
      status: client.status
    })).sort((left, right) => left.packageId.localeCompare(right.packageId))
  }), "utf8"));
}

async function readRecord({ dataDir = "", alias = DEFAULT_ALIAS } = {}) {
  const statePath = processIdentityStatePath({ dataDir, alias });
  const sealingPath = processIdentitySealingKeyPath({ dataDir, alias });
  try {
    const [record, sealingKeyBase64] = await Promise.all([
      fs.promises.readFile(statePath, "utf8").then((raw) => JSON.parse(raw)),
      fs.promises.readFile(sealingPath, "utf8").then((raw) => text(raw))
    ]);
    return { ...record, sealingKeyBase64 };
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    const timestamp = nowIso();
    const state = normalizeState({
      alias,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const sealingKeyBase64 = crypto.randomBytes(32).toString("base64");
    return {
      protocolVersion: PROCESS_IDENTITY_PROTOCOL_VERSION,
      alias: safeAlias(alias),
      stateRoot: stateRoot(state),
      sealedState: sealJson({ sealingKeyBase64, payload: state }),
      sealingKeyBase64,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }
}

async function writeRecord({ dataDir = "", alias = DEFAULT_ALIAS } = {}, record = {}) {
  const { sealingKeyBase64, ...persistedRecord } = record;
  await writePrivateFileAtomic(processIdentitySealingKeyPath({ dataDir, alias }), `${text(sealingKeyBase64)}\n`);
  await writePrivateFileAtomic(processIdentityStatePath({ dataDir, alias }), `${JSON.stringify(persistedRecord, null, 2)}\n`);
  return record;
}

function openState(record = {}) {
  const state = normalizeState(openSealedJson({
    sealingKeyBase64: record.sealingKeyBase64,
    sealed: record.sealedState
  }));
  if (record.stateRoot && stateRoot(state) !== record.stateRoot) {
    throw new Error("Process identity sealed state root mismatch.");
  }
  return state;
}

function createRecord({ alias = DEFAULT_ALIAS, state, sealingKeyBase64 = "" } = {}) {
  const timestamp = nowIso();
  const normalized = normalizeState({
    ...asObject(state),
    alias,
    updatedAt: timestamp
  });
  const key = text(sealingKeyBase64) || crypto.randomBytes(32).toString("base64");
  return {
    protocolVersion: PROCESS_IDENTITY_PROTOCOL_VERSION,
    alias: safeAlias(alias),
    stateRoot: stateRoot(normalized),
    sealedState: sealJson({ sealingKeyBase64: key, payload: normalized }),
    sealingKeyBase64: key,
    createdAt: text(state?.createdAt || timestamp),
    updatedAt: timestamp
  };
}

function publicKeyFromInput(input = {}) {
  const source = asObject(input);
  const pem = text(source.processPublicKeyPem || source.publicKeyPem || source.publicKey || source.clientPublicKeyPem);
  const spkiBase64 = text(source.processPublicKeySpkiBase64 || source.publicKeySpkiBase64 || source.clientPublicKeySpkiBase64);
  let publicKey = null;
  if (pem) {
    publicKey = crypto.createPublicKey(pem);
  } else if (spkiBase64) {
    publicKey = crypto.createPublicKey({
      key: Buffer.from(spkiBase64, "base64"),
      format: "der",
      type: "spki"
    });
  } else {
    throw Object.assign(new Error("process public key is required"), { status: 400, reasonCode: "process_public_key_missing" });
  }
  const spki = publicKey.export({ format: "der", type: "spki" });
  const hash = `sha256:${sha256Base64Url(spki)}`;
  return {
    publicKey,
    processPublicKeyPem: publicKey.export({ format: "pem", type: "spki" }),
    processPublicKeySpkiBase64: spki.toString("base64"),
    processPublicKeyHash: hash,
    processKeyId: text(source.processKeyId) || `pk_${hash.slice("sha256:".length, "sha256:".length + 24)}`
  };
}

function normalizeClientFingerprint(input = {}, {
  required = false,
  clientId = "",
  installationId = "",
  processPublicKeyHash = ""
} = {}) {
  const source = asObject(input);
  const nested = asObject(source.clientFingerprint || source.client_fingerprint || source.fingerprint, source);
  const fingerprintId = text(
    nested.fingerprintId ||
      nested.fingerprint_id ||
      source.clientFingerprintId ||
      source.client_fingerprint_id ||
      source.fingerprintId ||
      source.fingerprint_id
  );
  const machineInstanceId = text(
    nested.machineInstanceId ||
      nested.machine_instance_id ||
      source.machineInstanceId ||
      source.machine_instance_id
  );
  const appInstanceId = text(
    nested.appInstanceId ||
      nested.app_instance_id ||
      source.appInstanceId ||
      source.app_instance_id
  );
  const runtimeInstanceId = text(
    nested.runtimeInstanceId ||
      nested.runtime_instance_id ||
      source.runtimeInstanceId ||
      source.runtime_instance_id
  );
  if (!fingerprintId && !machineInstanceId && !appInstanceId && !runtimeInstanceId) {
    if (required) {
      throw Object.assign(new Error("client fingerprint is required"), { status: 400, reasonCode: "client_fingerprint_missing" });
    }
    return {};
  }
  if (required && (!fingerprintId || !machineInstanceId || !appInstanceId || !runtimeInstanceId)) {
    throw Object.assign(new Error("client fingerprint is incomplete"), { status: 400, reasonCode: "client_fingerprint_incomplete" });
  }
  const computedHash = clientFingerprintHash({
    fingerprintId,
    machineInstanceId,
    appInstanceId,
    runtimeInstanceId
  });
  const suppliedHash = text(nested.fingerprintHash || nested.fingerprint_hash || source.clientFingerprintHash || source.client_fingerprint_hash);
  if (suppliedHash && suppliedHash !== computedHash) {
    throw Object.assign(new Error("client fingerprint hash mismatch"), { status: 400, reasonCode: "client_fingerprint_hash_mismatch" });
  }
  return {
    schemaVersion: text(nested.schemaVersion) || "v0.0.1:schema:definition-1",
    protocolVersion: text(nested.protocolVersion) || PROCESS_IDENTITY_PROTOCOL_VERSION,
    fingerprintVersion: text(nested.fingerprintVersion) || CLIENT_FINGERPRINT_VERSION,
    fingerprintId,
    machineInstanceId,
    appInstanceId,
    runtimeInstanceId,
    fingerprintHash: computedHash,
    createdAtUnix: Number(nested.createdAtUnix || nested.created_at_unix || 0),
    updatedAtUnix: Number(nested.updatedAtUnix || nested.updated_at_unix || 0)
  };
}

function privateKeyFromPem(privateKeyPem = "") {
  return crypto.createPrivateKey(text(privateKeyPem));
}

function signStableObject(privateKeyPem = "", payload = {}) {
  return crypto.sign(null, Buffer.from(stableJson(payload), "utf8"), privateKeyFromPem(privateKeyPem)).toString("base64url");
}

export function verifyClientIdentityPackageSignature({ packageObject = null, serverPublicKeyPem = "" } = {}) {
  const packageSource = asObject(packageObject, null);
  const signature = packageSource?.signature || {};
  if (!packageSource || !text(signature.value)) {
    return { ok: false, reasonCode: "identity_package_signature_missing" };
  }
  const { signature: _signature, ...payload } = packageSource;
  void _signature;
  const publicKey = crypto.createPublicKey(text(serverPublicKeyPem) || packageSource.serverPublicKeyPem || "");
  const ok = crypto.verify(
    null,
    Buffer.from(stableJson(payload), "utf8"),
    publicKey,
    Buffer.from(text(signature.value), "base64url")
  );
  return ok
    ? { ok: true, reasonCode: "identity_package_signature_valid" }
    : { ok: false, reasonCode: "identity_package_signature_invalid" };
}

function clientBindingContext(client = {}) {
  const fingerprint = normalizeClientFingerprint(client.clientFingerprint, { required: false });
  return {
    namespace: "process-identity",
    clientId: client.clientId,
    serverId: client.serverId,
    packageId: client.packageId,
    processKeyId: client.processKeyId,
    processPublicKeyHash: client.processPublicKeyHash,
    fingerprintId: fingerprint.fingerprintId || "",
    machineInstanceId: fingerprint.machineInstanceId || "",
    appInstanceId: fingerprint.appInstanceId || "",
    runtimeInstanceId: fingerprint.runtimeInstanceId || "",
    clientFingerprintHash: fingerprint.fingerprintHash || "",
    identityGeneration: String(client.identityGeneration || ""),
    defaultIdentityHash: client.defaultIdentityHash
  };
}

function createClientIdentityPackage({ state, client, capabilityKey = "", nonce = "" } = {}) {
  const serverIdentity = state.serverIdentity || {};
  const payload = {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: CLIENT_IDENTITY_PACKAGE_VERSION,
    packageId: client.packageId,
    clientId: client.clientId,
    installationId: client.installationId,
    serverId: client.serverId,
    serverTrustPin: client.serverTrustPin,
    serverPublicKeyPem: serverIdentity.publicKeyPem,
    serverPublicKeySpkiBase64: serverIdentity.publicKeySpkiBase64,
    serverKeyId: serverIdentity.serverKeyId,
    processKey: {
      processKeyId: client.processKeyId,
      publicKeyPem: client.processPublicKeyPem,
      publicKeySpkiBase64: client.processPublicKeySpkiBase64,
      publicKeyHash: client.processPublicKeyHash
    },
    clientFingerprint: normalizeClientFingerprint(client.clientFingerprint, { required: false }),
    defaultIdentityHash: client.defaultIdentityHash,
    identityGeneration: client.identityGeneration,
    issuedAt: client.issuedAt,
    expiresAt: client.expiresAt,
    capabilities: client.capabilities,
    capability: {
      type: "opaque-capability-key",
      key: capabilityKey,
      credentialId: client.capabilityCredentialId
    },
    claimNonce: text(nonce)
  };
  return {
    ...payload,
    signature: {
      algorithm: "ed25519",
      keyId: serverIdentity.serverKeyId,
      value: signStableObject(serverIdentity.privateKeyPem, payload)
    }
  };
}

export function canonicalProcessIdentityRequest({
  method = "GET",
  pathWithQuery = "/",
  bodySha256 = "",
  timestamp = "",
  nonce = "",
  clientId = "",
  packageId = "",
  processKeyId = "",
  clientFingerprint = {}
} = {}) {
  const fingerprint = normalizeClientFingerprint(clientFingerprint, { required: false });
  const parts = [
    PROCESS_IDENTITY_CANONICAL_REQUEST_VERSION,
    text(method).toUpperCase(),
    text(pathWithQuery) || "/",
    text(bodySha256).toLowerCase(),
    text(timestamp),
    text(nonce),
    text(clientId),
    text(packageId),
    text(processKeyId)
  ];
  const fingerprintParts = [
    fingerprint.fingerprintId || "",
    fingerprint.machineInstanceId || "",
    fingerprint.appInstanceId || "",
    fingerprint.runtimeInstanceId || "",
    fingerprint.fingerprintHash || ""
  ];
  if (fingerprintParts.some(Boolean)) {
    parts.push(...fingerprintParts);
  }
  return parts.join("\n");
}

function bodySha256Hex(body = Buffer.alloc(0)) {
  const value = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ""), "utf8");
  return sha256Hex(value);
}

function pathWithQueryFromUrl(url = null) {
  if (!url) return "/";
  return `${url.pathname || "/"}${url.search || ""}`;
}

function headerValue(headers = {}, name = "") {
  const lower = name.toLowerCase();
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === lower);
  const value = entry?.[1];
  return Array.isArray(value) ? text(value[0]) : text(value);
}

function capabilityKeyFromHeaders(headers = {}) {
  const explicit = headerValue(headers, "x-pact-capability-key");
  if (explicit) {
    return explicit;
  }
  const authorization = headerValue(headers, "authorization");
  const match = authorization.match(/^Bearer\s+(ock_[A-Za-z0-9_-]+)$/i);
  return match ? match[1] : "";
}

function clientFingerprintFromHeaders(headers = {}) {
  const candidate = {
    fingerprintId: headerValue(headers, "x-pact-client-fingerprint-id"),
    machineInstanceId: headerValue(headers, "x-pact-machine-instance-id"),
    appInstanceId: headerValue(headers, "x-pact-app-instance-id"),
    runtimeInstanceId: headerValue(headers, "x-pact-runtime-instance-id"),
    fingerprintHash: headerValue(headers, "x-pact-client-fingerprint-hash")
  };
  return normalizeClientFingerprint(candidate, { required: false });
}

function clientFingerprintMatches(left = {}, right = {}) {
  return text(left.fingerprintId) === text(right.fingerprintId) &&
    text(left.machineInstanceId) === text(right.machineInstanceId) &&
    text(left.appInstanceId) === text(right.appInstanceId) &&
    text(left.runtimeInstanceId) === text(right.runtimeInstanceId) &&
    text(left.fingerprintHash) === text(right.fingerprintHash);
}

function timingSafeTextEqual(left = "", right = "") {
  const leftHash = crypto.createHash("sha256").update(String(left || ""), "utf8").digest();
  const rightHash = crypto.createHash("sha256").update(String(right || ""), "utf8").digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function operationRequiredCapabilities(operation = {}) {
  const configured = uniqueStrings(asArray(operation.processIdentity?.requiredCapabilities));
  return configured.length > 0 ? configured : [apiCapabilityId(operation.id || "")].filter(Boolean);
}

function requestIsLoopback(request = null) {
  const ip = clientIpFromRequest(request, { unknown: "" });
  if (!isLoopbackAddress(ip)) {
    return false;
  }
  const host = headerValue(request?.headers || {}, "host");
  return !host || isLocalHttpHost(host);
}

function deny(status, reasonCode, error) {
  return { ok: false, status, reasonCode, error };
}

function normalizeClientInput(input = {}) {
  const source = asObject(input);
  const key = publicKeyFromInput(source);
  const clientId = text(source.clientId) || `client_${sha256TextBase64Url(key.processPublicKeyHash).slice(0, 24)}`;
  const installationId = text(source.installationId) || `install_${sha256TextBase64Url(`${clientId}:${key.processPublicKeyHash}`).slice(0, 24)}`;
  const clientFingerprint = normalizeClientFingerprint(source, {
    required: true,
    clientId,
    installationId,
    processPublicKeyHash: key.processPublicKeyHash
  });
  const defaultIdentityHash = text(source.defaultIdentityHash || source.default_identity_hash);
  if (!defaultIdentityHash) {
    throw Object.assign(new Error("default identity hash is required"), { status: 400, reasonCode: "default_identity_hash_missing" });
  }
  const capabilities = uniqueStrings([
    ...DEFAULT_PROCESS_IDENTITY_CAPABILITIES,
    ...asArray(source.capabilities)
  ]);
  return {
    ...key,
    clientId,
    installationId,
    clientFingerprint,
    defaultIdentityHash,
    capabilities
  };
}

export function generateProcessIdentityClientKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeySpki = publicKey.export({ format: "der", type: "spki" });
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }),
    publicKeySpkiBase64: publicKeySpki.toString("base64"),
    publicKeyHash: `sha256:${sha256Base64Url(publicKeySpki)}`
  };
}

export function createProcessIdentityRequestHeaders({
  privateKeyPem = "",
  method = "POST",
  url = "/",
  body = "",
  clientIdentityPackage = {},
  timestamp = nowIso(),
  nonce = randomToken("nonce", 18)
} = {}) {
  const packageObject = asObject(clientIdentityPackage);
  const processKey = asObject(packageObject.processKey);
  const clientFingerprint = normalizeClientFingerprint(packageObject.clientFingerprint, { required: false });
  const pathWithQuery = typeof url === "string"
    ? pathWithQueryFromUrl(new URL(url, "http://127.0.0.1"))
    : pathWithQueryFromUrl(url);
  const bodyHash = bodySha256Hex(Buffer.isBuffer(body) ? body : Buffer.from(String(body || ""), "utf8"));
  const canonical = canonicalProcessIdentityRequest({
    method,
    pathWithQuery,
    bodySha256: bodyHash,
    timestamp,
    nonce,
    clientId: packageObject.clientId,
    packageId: packageObject.packageId,
    processKeyId: processKey.processKeyId,
    clientFingerprint
  });
  const signature = crypto.sign(null, Buffer.from(canonical, "utf8"), privateKeyFromPem(privateKeyPem)).toString("base64url");
  return {
    "X-Pact-Client-Id": packageObject.clientId,
    "X-Pact-Identity-Package-Id": packageObject.packageId,
    "X-Pact-Process-Key-Id": processKey.processKeyId,
    "X-Pact-Timestamp": timestamp,
    "X-Pact-Nonce": nonce,
    "X-Pact-Body-SHA256": bodyHash,
    "X-Pact-Client-Fingerprint-Id": clientFingerprint.fingerprintId || "",
    "X-Pact-Machine-Instance-Id": clientFingerprint.machineInstanceId || "",
    "X-Pact-App-Instance-Id": clientFingerprint.appInstanceId || "",
    "X-Pact-Runtime-Instance-Id": clientFingerprint.runtimeInstanceId || "",
    "X-Pact-Client-Fingerprint-Hash": clientFingerprint.fingerprintHash || "",
    "X-Pact-Signature": signature,
    "X-Pact-Capability-Key": asObject(packageObject.capability).key
  };
}

export function createProcessIdentityService({
  dataDir = "",
  alias = DEFAULT_ALIAS,
  claimToken = "",
  claimTokenFile = "",
  capabilityKeyProvider = null,
  capabilityBindingGuard = null,
  maxTimestampSkewMs = DEFAULT_NONCE_TTL_MS,
  nonceTtlMs = DEFAULT_NONCE_TTL_MS
} = {}) {
  const resolvedAlias = safeAlias(alias);
  const resolvedDataDir = resolveDataDir(dataDir);
  const resolvedCapabilityKeyProvider = capabilityKeyProvider || createOpaqueCapabilityKeyProvider({
    dataDir: resolvedDataDir,
    alias: `${resolvedAlias}-capabilities`
  });
  const resolvedBindingGuard = capabilityBindingGuard || createCapabilityBindingGuard({
    dataDir: resolvedDataDir,
    alias: `${resolvedAlias}-bindings`
  });
  let loaded = false;
  let record = null;
  let state = null;
  let mutationQueue = Promise.resolve();

  async function load() {
    if (loaded) {
      return state;
    }
    record = await readRecord({ dataDir: resolvedDataDir, alias: resolvedAlias });
    state = openState(record);
    loaded = true;
    if (!record.sealingKeyBase64 || !record.sealedState) {
      await save();
    } else if (!fs.existsSync(processIdentityStatePath({ dataDir: resolvedDataDir, alias: resolvedAlias }))) {
      await writeRecord({ dataDir: resolvedDataDir, alias: resolvedAlias }, record);
    }
    return state;
  }

  async function save() {
    state = normalizeState({
      ...state,
      alias: resolvedAlias,
      updatedAt: nowIso()
    });
    record = createRecord({
      alias: resolvedAlias,
      state,
      sealingKeyBase64: record?.sealingKeyBase64
    });
    await writeRecord({ dataDir: resolvedDataDir, alias: resolvedAlias }, record);
    loaded = true;
    return state;
  }

  function enqueueMutation(action) {
    const run = mutationQueue.catch(() => {}).then(async () => {
      await load();
      return action();
    });
    mutationQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function expectedClaimToken() {
    const direct = text(claimToken || process.env.PACT_PROCESS_IDENTITY_CLAIM_TOKEN);
    if (direct) {
      return direct;
    }
    const filePath = text(claimTokenFile || process.env.PACT_PROCESS_IDENTITY_CLAIM_TOKEN_FILE);
    if (!filePath) {
      return "";
    }
    return text(await fs.promises.readFile(filePath, "utf8"));
  }

  function findActiveClient({ clientId = "", packageId = "", processKeyId = "" } = {}) {
    return (state.clients || []).find((client) =>
      client.status === "valid" &&
      client.clientId === text(clientId) &&
      client.packageId === text(packageId) &&
      client.processKeyId === text(processKeyId)
    ) || null;
  }

  async function bootstrapClaim({ request = null, input = {} } = {}) {
    return enqueueMutation(async () => {
      const source = asObject(input);
      if (!requestIsLoopback(request)) {
        return deny(403, "bootstrap_claim_loopback_required", "Process identity bootstrap claim is restricted to loopback clients.");
      }
      const expected = await expectedClaimToken();
      if (!expected) {
        return deny(503, "bootstrap_claim_token_unconfigured", "Process identity bootstrap claim token is not configured.");
      }
      const provided = text(source.claimToken || source.claim_token || headerValue(request?.headers || {}, "x-pact-claim-token"));
      if (!provided || !timingSafeTextEqual(provided, expected)) {
        return deny(401, "bootstrap_claim_token_invalid", "Process identity bootstrap claim token is invalid.");
      }
      if (state.claimed === true || state.clients.some((client) => client.status === "valid")) {
        return deny(409, "bootstrap_claim_already_consumed", "Process identity bootstrap claim has already been consumed.");
      }
      let normalizedClient;
      try {
        normalizedClient = normalizeClientInput(source);
      } catch (error) {
        return deny(error.status || 400, error.reasonCode || "bootstrap_claim_invalid", error.message);
      }
      const timestamp = nowIso();
      const packageId = text(source.packageId) || `cidpkg_${crypto.randomUUID()}`;
      const identityGeneration = 1;
      const credentialId = `procid_${packageId}`;
      const issued = await resolvedCapabilityKeyProvider.issue({
        credentialId,
        capabilities: normalizedClient.capabilities,
        issuedAt: timestamp,
        metadata: {
          component: "process-identity",
          packageId,
          clientId: normalizedClient.clientId,
          processKeyId: normalizedClient.processKeyId,
          clientFingerprintHash: normalizedClient.clientFingerprint.fingerprintHash
        }
      });
      const client = normalizeClientRecord({
        packageId,
        clientId: normalizedClient.clientId,
        installationId: normalizedClient.installationId,
        serverId: state.serverIdentity.serverId,
        serverTrustPin: state.serverIdentity.serverTrustPin,
        processKeyId: normalizedClient.processKeyId,
        processPublicKeyPem: normalizedClient.processPublicKeyPem,
        processPublicKeySpkiBase64: normalizedClient.processPublicKeySpkiBase64,
        processPublicKeyHash: normalizedClient.processPublicKeyHash,
        clientFingerprint: normalizedClient.clientFingerprint,
        defaultIdentityHash: normalizedClient.defaultIdentityHash,
        identityGeneration,
        capabilityCredentialId: issued.credentialId,
        capabilities: normalizedClient.capabilities,
        status: "valid",
        issuedAt: timestamp,
        expiresAt: text(source.expiresAt)
      });
      const binding = await resolvedBindingGuard.bindCapabilityKey({
        capabilityKey: issued.capabilityKey,
        credentialId: client.capabilityCredentialId,
        context: clientBindingContext(client),
        expiresAt: client.expiresAt
      });
      state = {
        ...state,
        claimed: true,
        claimedAt: timestamp,
        claimCount: Number(state.claimCount || 0) + 1,
        clients: [client],
        usedNonces: []
      };
      await save();
      return {
        ok: true,
        status: 200,
        protocolVersion: PROCESS_IDENTITY_PROTOCOL_VERSION,
        serverIdentity: publicServerIdentity(state.serverIdentity),
        binding,
        clientIdentityPackage: createClientIdentityPackage({
          state,
          client,
          capabilityKey: issued.capabilityKey,
          nonce: source.nonce
        })
      };
    });
  }

  async function recordNonce({ nonce = "", packageId = "", timestampMs = 0 } = {}) {
    const nonceHash = sha256TextBase64Url(`${packageId}\0${nonce}`);
    const now = Date.now();
    const freshNonces = (state.usedNonces || [])
      .filter((item) => parseTimestampMs(item.expiresAt) > now)
      .slice(-MAX_NONCE_CACHE);
    if (freshNonces.some((item) => item.nonceHash === nonceHash)) {
      return { ok: false, reasonCode: "process_identity_nonce_replay" };
    }
    freshNonces.push({
      nonceHash,
      packageId,
      seenAt: nowIso(),
      expiresAt: new Date(Math.max(now, timestampMs) + Math.max(1, Number(nonceTtlMs || DEFAULT_NONCE_TTL_MS))).toISOString()
    });
    state = {
      ...state,
      usedNonces: freshNonces.slice(-MAX_NONCE_CACHE)
    };
    await save();
    return { ok: true };
  }

  async function verifySignedRequest({
    request = null,
    requestBody = Buffer.alloc(0),
    url = new URL("/", "http://127.0.0.1"),
    method = "GET",
    operation = {}
  } = {}) {
    await mutationQueue.catch(() => {});
    await load();
    if (operation?.processIdentity?.required !== true) {
      return { ok: true, applicable: false, reasonCode: "process_identity_not_required" };
    }
    const headers = request?.headers || {};
    const clientId = headerValue(headers, "x-pact-client-id");
    const packageId = headerValue(headers, "x-pact-identity-package-id");
    const processKeyId = headerValue(headers, "x-pact-process-key-id");
    const timestamp = headerValue(headers, "x-pact-timestamp");
    const nonce = headerValue(headers, "x-pact-nonce");
    const bodyHash = headerValue(headers, "x-pact-body-sha256").toLowerCase();
    const signature = headerValue(headers, "x-pact-signature");
    const capabilityKey = capabilityKeyFromHeaders(headers);
    if (!clientId || !packageId || !processKeyId || !timestamp || !nonce || !bodyHash || !signature || !capabilityKey) {
      return deny(401, "process_identity_headers_missing", "Process identity signature headers are required.");
    }
    if (bodyHash !== bodySha256Hex(requestBody)) {
      return deny(401, "process_identity_body_hash_mismatch", "Process identity body hash mismatch.");
    }
    const timestampMs = parseTimestampMs(timestamp);
    if (!timestampMs || Math.abs(Date.now() - timestampMs) > Math.max(1000, Number(maxTimestampSkewMs || DEFAULT_NONCE_TTL_MS))) {
      return deny(401, "process_identity_timestamp_invalid", "Process identity timestamp is outside the accepted window.");
    }
    const client = findActiveClient({ clientId, packageId, processKeyId });
    if (!client) {
      return deny(401, "process_identity_package_unknown", "Process identity package is not active.");
    }
    const expectedFingerprint = normalizeClientFingerprint(client.clientFingerprint, { required: false });
    let requestFingerprint;
    try {
      requestFingerprint = clientFingerprintFromHeaders(headers);
    } catch {
      return deny(401, "process_identity_client_fingerprint_mismatch", "Process identity client fingerprint hash is invalid.");
    }
    if (expectedFingerprint.fingerprintId) {
      if (!requestFingerprint.fingerprintId || !requestFingerprint.machineInstanceId || !requestFingerprint.appInstanceId || !requestFingerprint.runtimeInstanceId) {
        return deny(401, "process_identity_client_fingerprint_missing", "Process identity client fingerprint headers are required.");
      }
      if (!clientFingerprintMatches(expectedFingerprint, requestFingerprint)) {
        return deny(401, "process_identity_client_fingerprint_mismatch", "Process identity client fingerprint does not match the signed package.");
      }
    }
    const canonical = canonicalProcessIdentityRequest({
      method,
      pathWithQuery: pathWithQueryFromUrl(url),
      bodySha256: bodyHash,
      timestamp,
      nonce,
      clientId,
      packageId,
      processKeyId,
      clientFingerprint: requestFingerprint
    });
    const signatureOk = crypto.verify(
      null,
      Buffer.from(canonical, "utf8"),
      crypto.createPublicKey(client.processPublicKeyPem),
      Buffer.from(signature, "base64url")
    );
    if (!signatureOk) {
      return deny(401, "process_identity_signature_invalid", "Process identity request signature is invalid.");
    }
    const requiredCapabilities = operationRequiredCapabilities(operation);
    const capabilityDecision = await resolvedCapabilityKeyProvider.verify({
      capabilityKey,
      requiredCapabilities,
      includeRecordDetails: true
    });
    if (!capabilityDecision.ok) {
      return deny(403, capabilityDecision.reasonCode || "process_identity_capability_denied", "Process identity capability key is not authorized.");
    }
    const bindingDecision = await resolvedBindingGuard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: client.capabilityCredentialId,
      context: clientBindingContext(client)
    });
    const requireBinding = operation.processIdentity?.requireBinding !== false;
    if (!bindingDecision.ok || (requireBinding && bindingDecision.applicable === false)) {
      return deny(
        403,
        bindingDecision.reasonCode || "process_identity_binding_denied",
        "Process identity capability binding is not authorized."
      );
    }
    return enqueueMutation(async () => {
      const nonceDecision = await recordNonce({ nonce, packageId, timestampMs });
      if (!nonceDecision.ok) {
        return deny(401, nonceDecision.reasonCode, "Process identity request nonce was already used.");
      }
      const actor = {
        type: "process-client",
        userId: client.clientId,
        subjectId: client.clientId,
        username: client.clientId,
        roleId: "process-identity",
        grantId: client.packageId,
        clientId: client.clientId,
        packageId: client.packageId,
        processKeyId: client.processKeyId,
        clientFingerprint: client.clientFingerprint,
        scopes: [],
        capabilities: requiredCapabilities
      };
      return {
        ok: true,
        applicable: true,
        reasonCode: "process_identity_verified",
        client,
        capabilityKey,
        requiredCapabilities,
        capabilityDecision,
        bindingDecision,
        actor,
        authSession: { user: actor }
      };
    });
  }

  async function rotateClientIdentityPackage({ request = null, input = {} } = {}) {
    const verification = request?.__pactProcessIdentity;
    if (!verification?.ok || !verification.client || !verification.capabilityKey) {
      return deny(401, "process_identity_verification_required", "Current process identity verification is required.");
    }
    return enqueueMutation(async () => {
      const source = asObject(input);
      const current = findActiveClient({
        clientId: verification.client.clientId,
        packageId: verification.client.packageId,
        processKeyId: verification.client.processKeyId
      });
      if (!current) {
        return deny(409, "process_identity_package_not_active", "Current process identity package is no longer active.");
      }
      const key = source.processPublicKeyPem || source.processPublicKeySpkiBase64 || source.publicKeyPem || source.publicKeySpkiBase64
        ? publicKeyFromInput(source)
        : {
            processKeyId: current.processKeyId,
            processPublicKeyPem: current.processPublicKeyPem,
            processPublicKeySpkiBase64: current.processPublicKeySpkiBase64,
            processPublicKeyHash: current.processPublicKeyHash
          };
      const timestamp = nowIso();
      const packageId = text(source.packageId) || `cidpkg_${crypto.randomUUID()}`;
      const credentialId = `procid_${packageId}`;
      const capabilities = current.capabilities.length ? current.capabilities : DEFAULT_PROCESS_IDENTITY_CAPABILITIES;
      const rotated = await resolvedCapabilityKeyProvider.rotateCapabilityKey({
        capabilityKey: verification.capabilityKey,
        capabilities,
        credentialId,
        reason: text(source.reason) || "process_identity_package_rotated",
        metadata: {
          component: "process-identity",
          packageId,
          clientId: current.clientId,
          processKeyId: key.processKeyId
        }
      });
      if (!rotated.ok) {
        return deny(403, rotated.reasonCode || "process_identity_rotation_denied", "Process identity capability key rotation failed.");
      }
      await resolvedBindingGuard.invalidateCapabilityKeyBinding({
        capabilityKey: verification.capabilityKey,
        credentialId: current.capabilityCredentialId,
        reason: "process_identity_package_rotated"
      });
      const nextClient = normalizeClientRecord({
        ...current,
        packageId,
        processKeyId: key.processKeyId,
        processPublicKeyPem: key.processPublicKeyPem,
        processPublicKeySpkiBase64: key.processPublicKeySpkiBase64,
        processPublicKeyHash: key.processPublicKeyHash,
        identityGeneration: Number(current.identityGeneration || 1) + 1,
        capabilityCredentialId: rotated.credentialId,
        capabilities,
        status: "valid",
        issuedAt: timestamp,
        expiresAt: text(source.expiresAt || current.expiresAt),
        rotatedAt: "",
        revokedAt: "",
        revocationReason: ""
      });
      await resolvedBindingGuard.bindCapabilityKey({
        capabilityKey: rotated.capabilityKey,
        credentialId: nextClient.capabilityCredentialId,
        context: clientBindingContext(nextClient),
        expiresAt: nextClient.expiresAt
      });
      state = {
        ...state,
        clients: [
          ...state.clients.map((client) => client.packageId === current.packageId
            ? normalizeClientRecord({ ...client, status: "rotated", rotatedAt: timestamp })
            : client),
          nextClient
        ]
      };
      await save();
      return {
        ok: true,
        status: 200,
        protocolVersion: PROCESS_IDENTITY_PROTOCOL_VERSION,
        serverIdentity: publicServerIdentity(state.serverIdentity),
        clientIdentityPackage: createClientIdentityPackage({
          state,
          client: nextClient,
          capabilityKey: rotated.capabilityKey,
          nonce: source.nonce
        })
      };
    });
  }

  async function revokeClientIdentityPackage({ request = null, input = {} } = {}) {
    const verification = request?.__pactProcessIdentity;
    if (!verification?.ok || !verification.client || !verification.capabilityKey) {
      return deny(401, "process_identity_verification_required", "Current process identity verification is required.");
    }
    return enqueueMutation(async () => {
      const timestamp = nowIso();
      const reason = text(asObject(input).reason) || "process_identity_package_revoked";
      await resolvedCapabilityKeyProvider.invalidate({
        capabilityKey: verification.capabilityKey,
        reason
      });
      await resolvedBindingGuard.invalidateCapabilityKeyBinding({
        capabilityKey: verification.capabilityKey,
        credentialId: verification.client.capabilityCredentialId,
        reason
      });
      state = {
        ...state,
        clients: state.clients.map((client) => client.packageId === verification.client.packageId
          ? normalizeClientRecord({
              ...client,
              status: "revoked",
              revokedAt: timestamp,
              revocationReason: reason
            })
          : client)
      };
      await save();
      return {
        ok: true,
        status: 200,
        protocolVersion: PROCESS_IDENTITY_PROTOCOL_VERSION,
        packageId: verification.client.packageId,
        revokedAt: timestamp,
        reason
      };
    });
  }

  async function describe() {
    await mutationQueue.catch(() => {});
    await load();
    return {
      ok: true,
      protocolVersion: PROCESS_IDENTITY_PROTOCOL_VERSION,
      alias: resolvedAlias,
      stateRoot: stateRoot(state),
      serverIdentity: publicServerIdentity(state.serverIdentity),
      claimed: state.claimed === true,
      claimCount: Number(state.claimCount || 0),
      activeClientCount: state.clients.filter((client) => client.status === "valid").length,
      clientCount: state.clients.length,
      statePath: processIdentityStatePath({ dataDir: resolvedDataDir, alias: resolvedAlias })
    };
  }

  return Object.freeze({
    protocolVersion: PROCESS_IDENTITY_PROTOCOL_VERSION,
    bootstrapClaim,
    verifySignedRequest,
    rotateClientIdentityPackage,
    revokeClientIdentityPackage,
    describe,
    capabilityKeyProvider: resolvedCapabilityKeyProvider,
    capabilityBindingGuard: resolvedBindingGuard,
    close() {
      resolvedCapabilityKeyProvider.close?.();
      resolvedBindingGuard.close?.();
    }
  });
}
